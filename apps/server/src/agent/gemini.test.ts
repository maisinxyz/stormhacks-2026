import { describe, expect, it } from 'vitest';
import { geminiBrain, geminiTools, type GeminiClient } from './gemini';

const input = {
  pet: { name: 'Pip', species: 'dog', personality: { eager: 0.8, sassy: 0.2, anxious: 0.1, chatty: 0.4 } },
  text: 'check my inbox',
  user: { id: 'gemini-test', name: 'Test User', createdAt: new Date().toISOString() },
  now: new Date().toISOString(),
} as any;

describe('Gemini brain adapter', () => {
  it('converts shared tools and sends function results back to Gemini', async () => {
    const requests: any[] = [];
    const responses = [
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'p1', name: 'plan', args: { say: 'Checking your inbox!', steps: [{ verb: 'SEARCH', label: 'Checking unread email' }] } } }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Inbox checked.' }] } }] },
    ];
    const client: GeminiClient = async request => {
      requests.push(request);
      return responses.shift()!;
    };

    const session = geminiBrain({ apiKey: 'test-key', agentModel: 'gemini-2.5-flash' }, client)(input);
    const first = await session.next([], new AbortController().signal);
    expect(first.calls[0]).toMatchObject({ id: 'p1', name: 'plan' });
    expect(requests[0].tools[0].functionDeclarations.some((t: any) => t.name === 'finish')).toBe(true);

    await session.next([{ id: 'p1', content: 'Plan accepted.' }], new AbortController().signal);
    const toolResult = requests[1].contents.find((content: any) => content.role === 'user' && content.parts[0].functionResponse);
    expect(toolResult.parts[0].functionResponse).toMatchObject({ name: 'plan', id: 'p1' });
  });

  it('produces Gemini function declarations with input schemas', () => {
    const declarations = geminiTools()[0].functionDeclarations;
    expect(declarations.map(t => t.name)).toContain('gmail_search');
    expect(declarations.find(t => t.name === 'gmail_search')?.parameters.type).toBe('object');
  });
});
