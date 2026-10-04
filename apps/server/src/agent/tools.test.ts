import { describe, expect, it } from 'vitest';
import { MockWorkspace } from '../connectors/mock';
import { oneLine } from '../connectors/types';
import { TOOL_BY_NAME, TOOLS, apiName, type ToolContext } from './tools';

const ctx = (ws = new MockWorkspace()): ToolContext & { notes: string[] } => {
  const notes: string[] = [];
  return { connectors: ws, notes, progress: (n) => notes.push(n) };
};
const run = (name: string, input: unknown, t = ctx()) => {
  const def = TOOL_BY_NAME.get(name)!;
  return def.run(def.input.parse(input), t);
};

describe('tool registry', () => {
  it('has API-safe, unique names', () => {
    const names = TOOLS.map(t => apiName(t.name));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it('every outbound tool requires approval for any valid input', () => {
    const samples: Record<string, unknown> = {
      'gmail.send': { to: ['a@b.co'], subject: 's', body: 'b' },
      'drive.trash': { fileId: 'f', fileName: 'n' },
      'drive.share': { fileId: 'f', fileName: 'n', email: 'a@b.co' },
    };
    const outbound = TOOLS.filter(t => t.policy === 'outbound');
    expect(outbound.map(t => t.name).sort()).toEqual(Object.keys(samples).sort());
    for (const t of outbound) expect(t.approval?.(t.input.parse(samples[t.name]))).toBeTruthy();
  });

  it('calendar invites with attendees need approval and tag SEND; solo events do not', () => {
    const create = TOOL_BY_NAME.get('calendar.create')!;
    const base = { title: 'Focus', start: '2026-10-04T10:00:00Z', end: '2026-10-04T11:00:00Z' };
    expect(create.approval!(create.input.parse(base))).toBeNull();
    expect(create.verb(create.input.parse(base))).toBe('WRITE');
    const invite = create.input.parse({ ...base, attendees: ['a@b.co'] });
    expect(create.approval!(invite)?.kind).toBe('calendar_invite');
    expect(create.verb(invite)).toBe('SEND');
  });

  it('tags the PRD default verbs', () => {
    const v = (n: string, i: unknown = {}) => { const t = TOOL_BY_NAME.get(n)!; return t.verb(i); };
    expect([v('gmail.search'), v('drive.search')]).toEqual(['SEARCH', 'SEARCH']);
    expect([v('gmail.read'), v('calendar.list'), v('drive.read')]).toEqual(['READ', 'READ', 'READ']);
    expect(v('drive.get')).toBe('FETCH');
    expect([v('gmail.draft'), v('doc.create')]).toEqual(['WRITE', 'WRITE']);
    expect(v('gmail.send')).toBe('SEND');
    expect([v('drive.move'), v('drive.rename')]).toEqual(['ORGANIZE', 'ORGANIZE']);
    expect(v('pet.work', { verb: 'COMPARE' })).toBe('COMPARE');
  });

  it('rejects malformed recipients', () => {
    expect(TOOL_BY_NAME.get('gmail.send')!.input.safeParse({ to: ['not an email'], subject: 's', body: 'b' }).success).toBe(false);
  });
});

describe('mock connectors', () => {
  it('finds the budget sheet and reads it as CSV', async () => {
    const t = ctx();
    const found = await run('drive.search', { query: 'budget' }, t);
    const files = found.data as { id: string; name: string }[];
    expect(files[0].name).toMatch(/Budget/);
    expect(t.notes).toContain('Found 1 files');
    const read = await run('drive.read', { fileId: files[0].id }, t);
    expect((read.data as { text: string }).text).toContain('Total,8900,12000');
  });

  it('records undo info for reversible actions', async () => {
    const ws = new MockWorkspace();
    const out = await run('drive.rename', { fileId: 'file-budget', name: 'Budget FINAL' }, ctx(ws));
    expect(out.undo).toEqual({ rename: { fileId: 'file-budget', name: 'Budget - Q4 2025' } });
    expect(ws.files.find(f => f.id === 'file-budget')!.name).toBe('Budget FINAL');
  });

  it('send records to the sent box', async () => {
    const ws = new MockWorkspace();
    await run('gmail.send', { to: ['team@fetch.demo'], subject: 'Notes', body: 'hi' }, ctx(ws));
    expect(ws.sent).toHaveLength(1);
  });

  it('strips CR/LF from header values', () => {
    expect(oneLine('Hi\r\nBcc: evil@x.com')).toBe('Hi Bcc: evil@x.com');
  });
});
