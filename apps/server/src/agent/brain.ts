// The decision-maker behind a run. The runner owns events, tools, and approvals;
// a Brain only chooses the next tool calls. Claude (llm.ts) and MOCK_AGENT (mockBrain.ts) implement it.
import { z } from 'zod';
import type { PetInfo, User } from './types';

export interface ToolCall { id: string; name: string; input: Record<string, unknown> }
export interface ToolResultMsg { id: string; content: string; isError?: boolean }
/** No calls means the brain is done; `text` then becomes the summary. */
export interface BrainTurn { calls: ToolCall[]; text?: string }

export interface BrainSession { next(results: ToolResultMsg[], signal: AbortSignal): Promise<BrainTurn> }
export interface BrainInput { pet: PetInfo; text: string; user: User; now: string }
export type Brain = (input: BrainInput) => BrainSession;

// Meta tools every brain uses alongside the connector tools in tools.ts.
export const PLAN_TOOL = 'plan';
export const FINISH_TOOL = 'finish';

const VERBS = ['SEARCH', 'FETCH', 'READ', 'WRITE', 'COMPARE', 'ORGANIZE', 'SEND', 'WAIT', 'MONITOR', 'CALCULATE', 'NEGOTIATE', 'SUCCEED', 'FAIL'] as const;
const MOODS = ['neutral', 'eager', 'focused', 'proud', 'sheepish', 'exhausted', 'worried', 'smug', 'sleepy'] as const;

export const PlanInput = z.object({
  say: z.string().max(200).optional(),
  steps: z.array(z.object({
    verb: z.enum(VERBS),
    label: z.string().min(1).max(80),
    mood: z.enum(MOODS).optional(),
    prop: z.string().max(60).optional(),
  })).min(1).max(15),
});
export type PlanInput = z.infer<typeof PlanInput>;

export const FinishInput = z.object({
  summary: z.string().min(1).max(2000),
  say: z.string().max(200).optional(),
  mood: z.enum(MOODS).default('proud'),
  card: z.object({ title: z.string().max(200), text: z.string().max(2000).optional(), url: z.string().url().optional() }).optional(),
  prop: z.string().max(60).optional(),
});
export type FinishInput = z.infer<typeof FinishInput>;
