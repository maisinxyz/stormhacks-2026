// Composio app tools through the real runner, with a fake gateway (no network, no key).
import { afterEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '@fetch/contracts';
import type { ComposioGateway, ComposioToolInfo } from '../connectors/composio';
import { ConnectorError } from '../connectors/types';
import { verbForSlug } from './appTools';
import type { Brain, ToolCall } from './brain';
import { claudeTools } from './llm';
import { buildB1App } from './testApp';
import { toolset } from './toolset';

const info = (slug: string, toolkit: string, tags: string[]): ComposioToolInfo => ({
  slug, name: slug.split('_').slice(1).join(' ').toLowerCase(), description: '', toolkit, toolkitName: toolkit[0].toUpperCase() + toolkit.slice(1), tags,
});

class FakeComposio implements ComposioGateway {
  connected = new Set(['gmail']);
  executed: { slug: string; args: Record<string, unknown> }[] = [];
  disconnected: string[] = [];
  aborted: string[] = [];
  private waiters = new Map<string, () => void>();
  tools: Record<string, ComposioToolInfo> = {
    SLACK_LIST_CHANNELS: info('SLACK_LIST_CHANNELS', 'slack', ['readOnlyHint']),
    SLACK_SEND_MESSAGE: info('SLACK_SEND_MESSAGE', 'slack', ['openWorldHint']),
    GMAIL_FETCH_EMAILS: info('GMAIL_FETCH_EMAILS', 'gmail', ['readOnlyHint']),
    NOTION_DELETE_PAGE: info('NOTION_DELETE_PAGE', 'notion', ['readOnlyHint', 'destructiveHint']),
  };
  async search() { return { results: [{ useCase: 'post', primaryToolSlugs: ['SLACK_SEND_MESSAGE'], relatedToolSlugs: [], toolkits: ['slack'] }], toolSchemas: {}, connected: { slack: this.connected.has('slack') } }; }
  async toolInfo(slug: string) {
    const t = this.tools[slug];
    if (!t) throw new ConnectorError('unknown_tool', `No Composio tool named ${slug}`);
    return t;
  }
  async isConnected(_u: string, tk: string) { return this.connected.has(tk); }
  async connectedToolkits() { return [...this.connected]; }
  async authorize(_u: string, tk: string) {
    return {
      redirectUrl: `https://connect.composio.dev/link/${tk}`,
      wait: (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
        this.waiters.set(tk, res);
        setTimeout(() => rej(new Error('timeout')), ms);
        signal?.addEventListener('abort', () => { this.aborted.push(tk); rej(new Error('aborted')); });
      }),
    };
  }
  /** Simulates the user finishing the app's sign-in page. */
  finishConnect(tk: string) { this.connected.add(tk); this.waiters.get(tk)?.(); }
  async execute(_u: string, slug: string, args: Record<string, unknown>) {
    this.executed.push({ slug, args });
    return { successful: true, data: { ok: true, slug }, error: null };
  }
  async disconnect(_u: string, tk: string) { this.disconnected.push(tk); this.connected.delete(tk); }
}

type App = Awaited<ReturnType<typeof buildB1App>>;
const apps: App[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.app.close())); });

/** Brain that makes the given calls one turn at a time, then finishes. */
const script = (...calls: Omit<ToolCall, 'id'>[]): Brain => () => {
  let k = 0;
  return { async next() { const c = calls[k++]; return c ? { calls: [{ id: `c${k}`, ...c }] } : { calls: [], text: 'done' }; } };
};
const exec = (...tools: { tool_slug: string; arguments?: Record<string, unknown> }[]) =>
  ({ name: 'apps_execute', input: { stepId: 's1', tools: tools.map(t => ({ arguments: {}, ...t })) } });

let n = 0;
async function setup(brain: Brain, config: Record<string, unknown> = {}) {
  const fake = new FakeComposio();
  const a = await buildB1App({ brain, composio: fake, config: { demoUserId: `cmp-${++n}`, ...config } });
  apps.push(a);
  const run = async (text = 'x') => (await a.app.inject({ method: 'POST', url: '/agent/run', payload: { petId: 'dog', text } })).json().runId as string;
  return { a, fake, run };
}
async function waitFor(a: App, runId: string, pred: (e: RunEvent[]) => boolean) {
  for (let i = 0; i < 500; i++) {
    const ev = (await a.ctx.store.listEvents(runId, 0)).map(e => e.event);
    if (pred(ev)) return ev;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('timeout: ' + (await a.ctx.store.listEvents(runId, 0)).map(e => e.event.type).join(','));
}
const approvals = (e: RunEvent[]) => e.filter((x): x is Extract<RunEvent, { type: 'approval.required' }> => x.type === 'approval.required');
const ended = (e: RunEvent[]) => e.some(x => ['run.result', 'run.error', 'run.cancelled'].includes(x.type));
const approve = (a: App, runId: string, ap: { actionId: string; contentHash: string }, extra = {}) =>
  a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/approve`, payload: { actionId: ap.actionId, contentHash: ap.contentHash, ...extra } });

describe('toolset', () => {
  it('Composio mode gives the agent app tools instead of the native Google tools', () => {
    const names = claudeTools(toolset(true)).map(t => t.name);
    expect(names).toEqual(['plan', 'apps_search', 'apps_execute', 'pet_work', 'finish']);
    expect(claudeTools(toolset(false)).map(t => t.name)).toContain('gmail_send');
  });

  it('infers animation verbs from tool slugs', () => {
    expect(verbForSlug('SLACK_SEND_MESSAGE')).toBe('SEND');
    expect(verbForSlug('GITHUB_CREATE_ISSUE')).toBe('WRITE');
    expect(verbForSlug('NOTION_SEARCH_PAGES')).toBe('SEARCH');
    expect(verbForSlug('GMAIL_FETCH_EMAILS')).toBe('FETCH');
    expect(verbForSlug('GOOGLEDRIVE_DELETE_FILE')).toBe('ORGANIZE');
    expect(verbForSlug('LINEAR_GET_ISSUE')).toBe('READ');
  });

  it('uses Composio when configured, and MOCK_CONNECTORS still forces the offline demo tools', async () => {
    const { a } = await setup(script());
    expect(a.ctx.tools.map(t => t.name)).toContain('apps.execute');
    const mock = await buildB1App({ composio: new FakeComposio(), config: { mockConnectors: true } });
    apps.push(mock);
    expect(mock.ctx.composio).toBeUndefined();
    expect(mock.ctx.tools.map(t => t.name)).toContain('gmail.send');
  });
});

describe('apps.execute', () => {
  it('runs read-only tools on a connected app without approval', async () => {
    const { a, fake, run } = await setup(script(exec({ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { max_results: 5 } })));
    const runId = await run();
    const ev = await waitFor(a, runId, ended);
    expect(approvals(ev)).toHaveLength(0);
    expect(fake.executed).toEqual([{ slug: 'GMAIL_FETCH_EMAILS', args: { max_results: 5 } }]);
    expect(ev.find(e => e.type === 'tool.start')).toMatchObject({ tool: 'apps.execute' });
    expect(ev.at(-1)).toMatchObject({ type: 'run.result' });
  });

  it('auto-connects a missing app, then holds the write for approval with the exact arguments', async () => {
    const msg = { channel: '#standup', text: 'Notes are up!' };
    const { a, fake, run } = await setup(script(exec({ tool_slug: 'SLACK_LIST_CHANNELS' }, { tool_slug: 'SLACK_SEND_MESSAGE', arguments: msg })));
    const runId = await run('post the notes in slack');

    // 1) Slack isn't connected: the run pauses on a connect card carrying the sign-in link.
    let ev = await waitFor(a, runId, e => approvals(e).length === 1);
    const connect = approvals(ev)[0];
    expect(connect.kind).toBe('other');
    expect(connect.preview.body).toBe('https://connect.composio.dev/link/slack');
    expect(connect.preview.summary).toMatch(/Connect Slack/);
    expect(ev.some(e => e.type === 'run.say' && /Slack/.test(e.text))).toBe(true);
    expect((await approve(a, runId, connect)).json().error).toBe('not_connected_yet');
    expect(fake.executed).toHaveLength(0);

    // 2) The user finishes signing in: the run continues by itself to the approval for the write.
    fake.finishConnect('slack');
    ev = await waitFor(a, runId, e => approvals(e).length === 2);
    const write = approvals(ev)[1];
    expect(write.preview.to).toEqual(['#standup']);
    expect(write.preview.body).toContain('SLACK_SEND_MESSAGE');
    expect(write.preview.body).toContain('Notes are up!');
    expect(write.preview.summary).toMatch(/send message.*plus 1 read-only step/);
    expect(fake.executed).toHaveLength(0);

    // 3) Approve: both calls run exactly once, in order, with the stored arguments.
    expect((await approve(a, runId, write)).json()).toEqual({ ok: true, status: 'approved' });
    ev = await waitFor(a, runId, ended);
    expect(fake.executed).toEqual([{ slug: 'SLACK_LIST_CHANNELS', args: {} }, { slug: 'SLACK_SEND_MESSAGE', args: msg }]);
    expect(ev.at(-1)).toMatchObject({ type: 'run.result' });
  });

  it('cancelling the connect card ends the run with nothing executed', async () => {
    const { a, fake, run } = await setup(script(exec({ tool_slug: 'SLACK_LIST_CHANNELS' })));
    const runId = await run();
    await waitFor(a, runId, e => approvals(e).length === 1);
    await a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/cancel` });
    const ev = await waitFor(a, runId, ended);
    expect(ev.at(-1)).toMatchObject({ type: 'run.result', mood: 'sheepish' });
    expect(fake.executed).toHaveLength(0);
    expect(fake.aborted).toEqual(['slack']);   // the background connection poll was stopped
  });

  it('treats destructive tools as needing approval even if also tagged read-only', async () => {
    const { a, fake, run } = await setup(script(exec({ tool_slug: 'NOTION_DELETE_PAGE', arguments: { page_id: 'p1' } })));
    fake.connected.add('notion');
    const runId = await run();
    const ev = await waitFor(a, runId, e => approvals(e).length === 1);
    expect(approvals(ev)[0].kind).toBe('delete');
    expect(fake.executed).toHaveLength(0);
    // App-tool approvals can't be edited into something else.
    const res = await approve(a, runId, approvals(ev)[0], { edited: { body: 'x' } });
    expect(res.json().error).toBe('edit_not_supported');
  });

  it('returns unknown slugs to the model as an error without executing', async () => {
    const { a, fake, run } = await setup(script(exec({ tool_slug: 'MADE_UP_TOOL' })));
    const runId = await run();
    const ev = await waitFor(a, runId, ended);
    expect(ev.find(e => e.type === 'tool.end')).toMatchObject({ ok: false });
    expect(fake.executed).toHaveLength(0);
  });

  it('is blocked in Play mode', async () => {
    const { a, fake } = await setup(script(exec({ tool_slug: 'GMAIL_FETCH_EMAILS' })));
    await a.app.inject({ method: 'POST', url: '/mode', payload: { mode: 'play' } });
    const res = await a.app.inject({ method: 'POST', url: '/agent/run', payload: { petId: 'dog', text: 'x' } });
    expect(res.statusCode).toBe(403);
    expect(fake.executed).toHaveLength(0);
  });
});

describe('session + connectors with Composio', () => {
  it('reports connected apps and disconnects any app by slug', async () => {
    const { a, fake } = await setup(script());
    fake.connected.add('googledrive');
    const s = (await a.app.inject({ method: 'GET', url: '/session' })).json();
    expect(s.composio).toBe(true);
    expect(s.connected).toEqual({ gmail: true, calendar: false, drive: true });
    expect(s.apps.sort()).toEqual(['gmail', 'googledrive']);
    const res = await a.app.inject({ method: 'DELETE', url: '/connectors/drive' });
    expect(res.json().disconnected).toEqual(['googledrive']);
    expect(fake.disconnected).toEqual(['googledrive']);
    expect((await a.app.inject({ method: 'DELETE', url: '/connectors/Bad Name!' })).statusCode).toBe(404);
  });
});
