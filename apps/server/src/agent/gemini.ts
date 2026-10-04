// Gemini-backed Brain. The runner remains responsible for tools, approvals, and side effects.
// This adapter translates the shared Brain contract to Gemini's function-calling REST API.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Brain, BrainInput, BrainTurn, ToolResultMsg } from './brain';
import { FINISH_TOOL, FinishInput, PLAN_TOOL, PlanInput } from './brain';
import { apiName, PRESET_PROPS, TOOLS, type ToolDef } from './tools';
import { petBlock, rules } from './llm';

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
};
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };
type GeminiRequest = {
  systemInstruction: { parts: { text: string }[] };
  contents: GeminiContent[];
  tools: GeminiTool[];
  generationConfig: { maxOutputTokens: number; temperature: number };
};
type GeminiResponse = {
  candidates?: { content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};
export type GeminiClient = (request: GeminiRequest, signal: AbortSignal) => Promise<GeminiResponse>;

export interface GeminiTool {
  functionDeclarations: { name: string; description: string; parameters: Record<string, unknown> }[];
}

const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  return rest;
};

/** Gemini uses one functionDeclarations container instead of Anthropic's flat tools array. */
export function geminiTools(defs: ToolDef[] = TOOLS): GeminiTool[] {
  const stepId = z.string().describe('Id of the plan step this call belongs to, e.g. "run_x.s1".');
  return [{
    functionDeclarations: [
      { name: PLAN_TOOL, description: 'Announce or revise the ordered steps of this errand. Call before any other tool.', parameters: jsonSchema(PlanInput) },
      ...defs.map(t => ({
        name: apiName(t.name),
        description: t.description,
        parameters: jsonSchema((t.input as unknown as z.ZodObject).extend({ stepId })),
      })),
      { name: FINISH_TOOL, description: 'End the errand with the factual result, a short spoken line, and the outcome mood.', parameters: jsonSchema(FinishInput) },
    ],
  }];
}

function errorWithStatus(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/** Overload/rate-limit responses that are worth retrying (Gemini returns 503 "high demand" in spikes). */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash,gemini-flash-latest').split(',').map(s => s.trim()).filter(Boolean);

function geminiApiClient(apiKey?: string): GeminiClient {
  const once = geminiOnce(apiKey);
  return async (request, signal) => {
    const model = (request as GeminiRequest & { model?: string }).model;
    if (!model) throw new Error('Gemini model is not configured');
    // Retry the configured model through short spikes, then fall through to backup models.
    const models = [model, ...FALLBACK_MODELS.filter(m => m !== model)];
    let last: unknown;
    for (const [i, m] of models.entries()) {
      for (let attempt = 0; attempt < (i === 0 ? 3 : 2); attempt++) {
        try { return await once({ ...request, model: m } as GeminiRequest, signal); }
        catch (err) {
          last = err;
          const status = (err as { status?: number }).status;
          if (signal.aborted || (status !== undefined && !RETRYABLE.has(status))) throw err;
          await new Promise(r => setTimeout(r, 600 * 2 ** attempt));
        }
      }
    }
    throw last;
  };
}

function geminiOnce(apiKey?: string): GeminiClient {
  return async (request, signal) => {
    if (!apiKey) throw errorWithStatus(401, 'GEMINI_API_KEY is not configured');
    const model = (request as GeminiRequest & { model?: string }).model;
    if (!model) throw new Error('Gemini model is not configured');
    const { model: _model, ...requestBody } = request as GeminiRequest & { model: string };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw errorWithStatus(503, `Gemini request failed: ${(err as Error).message}`);
    }
    const responseText = await response.text();
    if (!response.ok) throw errorWithStatus(response.status, `Gemini API error: ${responseText.slice(0, 500)}`);
    try { return JSON.parse(responseText) as GeminiResponse; }
    catch { throw errorWithStatus(502, 'Gemini returned invalid JSON'); }
  };
}

type GeminiConfig = { apiKey?: string; agentModel: string };

export function geminiBrain(config: GeminiConfig, injected?: GeminiClient, defs: ToolDef[] = TOOLS): Brain {
  const tools = geminiTools(defs);
  let lazy: GeminiClient | undefined;
  const client = () => (lazy ??= injected ?? geminiApiClient(config.apiKey));

  return (input: BrainInput) => {
    const contents: GeminiContent[] = [{
      role: 'user',
      parts: [{ text: `<request>${input.text}</request>\nUser: ${input.user.name}. Current time: ${input.now}.` }],
    }];
    const callNames = new Map<string, string>();

    return {
      async next(results: ToolResultMsg[], signal: AbortSignal): Promise<BrainTurn> {
        if (results.length) {
          contents.push({
            role: 'user',
            parts: results.map(result => ({
              functionResponse: {
                name: callNames.get(result.id) ?? 'unknown_tool',
                id: result.id,
                response: result.isError ? { error: result.content } : { result: result.content },
              },
            })),
          });
        }
        const request = {
          model: config.agentModel,
          systemInstruction: { parts: [{ text: rules(defs.some(t => t.connector === 'composio')) }, { text: petBlock(input) }] },
          contents,
          tools,
          generationConfig: { maxOutputTokens: 16_000, temperature: 0.2 },
        } as GeminiRequest & { model: string };
        const response = await client()(request, signal);
        const candidate = response.candidates?.[0];
        if (!candidate?.content?.parts) {
          const reason = response.promptFeedback?.blockReason;
          if (reason) return { calls: [{ id: randomUUID(), name: FINISH_TOOL, input: { summary: `Gemini blocked this request (${reason}).`, say: 'I cannot fetch that one.', mood: 'sheepish' } }] };
          throw errorWithStatus(502, 'Gemini returned no candidate');
        }
        const content: GeminiContent = { role: 'model', parts: candidate.content.parts };
        contents.push(content);
        const calls = candidate.content.parts.flatMap(part => {
          const call = part.functionCall;
          if (!call?.name) return [];
          const id = call.id ?? randomUUID();
          callNames.set(id, call.name);
          return [{ id, name: call.name, input: call.args ?? {} }];
        });
        if (candidate.finishReason === 'MAX_TOKENS' && calls.length) throw errorWithStatus(502, 'Gemini output was truncated');
        const text = candidate.content.parts.flatMap(part => part.text ? [part.text] : []).join('\n');
        return { calls, text };
      },
    };
  };
}
