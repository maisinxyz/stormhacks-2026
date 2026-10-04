// Regression tests for the security review findings on approvals, retries, and event lifecycle.
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '@fetch/contracts';
import { googleConnectors } from '../connectors/google';
import { mockWorkspace } from '../connectors/mock';
import { ConnectorError } from '../connectors/types';
import type { Brain, ToolCall } from './brain';
import { stubMedia, stubPets } from './devStubs';
import { RunHub } from './hub';
import { registerB1 } from './plugin';
import { MemoryStore } from './store';
import { buildB1App } from './testApp';

type App = Awaited<ReturnType<typeof buildB1App>>;
const apps: App[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.app.close())); });

let n = 0;
/** A brain that makes one scripted call, then finishes. */
function oneCall(call: Omit<ToolCall, 'id'>): Brain {
  return () => {
    let turn = 0;
    return { async next() { return turn++ === 0 ? { calls: [{ id: 'c1', ...call }] } : { calls: [], text: 'done' }; } };
  };
}
async function setup(brain: Brain, config: Record<string, unknown> = {}) {
  const demoUserId = `hard-${++n}`;
  const a = await buildB1App({ brain, config: { mockConnectors: true, demoUserId, ...config } });
  apps.push(a);
  const runId = (await a.app.inject({ method: 'POST', url: '/agent/run', payload: { petId: 'dog', text: 'x' } })).json().runId as string;
  return { a, runId, ws: mockWorkspace(demoUserId) };
}
async function waitFor(a: App, runId: string, pred: (e: RunEvent[]) => boolean) {
  for (let i = 0; i < 500; i++) {
    const ev = (await a.ctx.store.listEvents(runId, 0)).map(e => e.event);
    if (pred(ev)) return ev;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('timeout');
}
const hasApproval = (e: RunEvent[]) => e.some(x => x.type === 'approval.required');
const ended = (e: RunEvent[]) => e.some(x => ['run.result', 'run.error', 'run.cancelled'].includes(x.type));
const lastApproval = (e: RunEvent[]) => e.filter((x): x is Extract<RunEvent, { type: 'approval.required' }> => x.type === 'approval.required').at(-1)!;
const invite = { title: 'Sync', start: '2026-10-04T10:00:00Z', end: '2026-10-04T10:30:00Z', attendees: ['alex@fetch.demo'] };

describe('review hardening', () => {
  it('an approved calendar invite runs exactly once even on a retryable failure', async () => {
    const { a, runId, ws } = await setup(oneCall({ name: 'calendar_create', input: { stepId: 's1', ...invite } }));
    let calls = 0;
    ws.calendar.create = async () => { calls++; throw new ConnectorError('upstream_unavailable', '503', true); };
    const appr = lastApproval(await waitFor(a, runId, hasApproval));
    await a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/approve`, payload: { actionId: appr.actionId, contentHash: appr.contentHash } });
    const ev = await waitFor(a, runId, ended);
    expect(calls).toBe(1);
    expect(ev.some(e => e.type === 'tool.retry')).toBe(false);
  });

  it('rejects edits to fields the tool does not have instead of running the original', async () => {
    const { a, runId, ws } = await setup(oneCall({ name: 'calendar_create', input: { stepId: 's1', ...invite } }));
    const appr = lastApproval(await waitFor(a, runId, hasApproval));
    const res = await a.app.inject({
      method: 'POST', url: `/agent/runs/${runId}/approve`,
      payload: { actionId: appr.actionId, contentHash: appr.contentHash, edited: { to: ['someone-else@fetch.demo'] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'edit_not_supported', fields: ['to'] });
    expect((await a.ctx.store.getApproval(appr.actionId))!.status).toBe('pending');
    expect(ws.events.some(e => e.title === 'Sync')).toBe(false);
  });

  it('approval previews name the real file, not the model-supplied name', async () => {
    const { a, runId, ws } = await setup(oneCall({ name: 'drive_trash', input: { stepId: 's1', fileId: 'file-budget', fileName: 'old notes' } }));
    const appr = lastApproval(await waitFor(a, runId, hasApproval));
    expect(appr.preview.summary).toContain('Budget - Q4 2025');
    expect(appr.preview.summary).not.toContain('old notes');
    expect((await a.ctx.store.getApproval(appr.actionId))!.payload.fileName).toBe('Budget - Q4 2025');
    await a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/cancel` });
    expect(ws.files.some(f => f.id === 'file-budget')).toBe(true);
  });

  it('an edit restarts the approval expiry clock', async () => {
    const { a, runId, ws } = await setup(
      oneCall({ name: 'gmail_send', input: { stepId: 's1', to: ['team@fetch.demo'], subject: 'Notes', body: 'long' } }),
      { approvalTtlMs: 300 },
    );
    const appr = lastApproval(await waitFor(a, runId, hasApproval));
    await new Promise(r => setTimeout(r, 200));
    const re = (await a.app.inject({
      method: 'POST', url: `/agent/runs/${runId}/approve`,
      payload: { actionId: appr.actionId, contentHash: appr.contentHash, edited: { body: 'short' } },
    })).json();
    await new Promise(r => setTimeout(r, 200));   // past the original deadline, inside the new one
    const ok = await a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/approve`, payload: { actionId: re.actionId, contentHash: re.contentHash } });
    expect(ok.json()).toEqual({ ok: true, status: 'approved' });
    await waitFor(a, runId, ended);
    expect(ws.sent.map(m => m.body)).toEqual(['short']);
  });

  it('drops events emitted after a terminal event', async () => {
    const store = new MemoryStore();
    const hub = new RunHub(store);
    await store.createRun({ id: 'r', userId: 'u', petId: 'p', text: '', status: 'running', steps: [], createdAt: '', updatedAt: '' });
    await hub.emit('r', { type: 'run.started', runId: 'r' });
    await hub.emit('r', { type: 'run.cancelled' });
    expect(await hub.emit('r', { type: 'tool.progress', stepId: 's', note: 'late' })).toBe(-1);
    expect((await store.listEvents('r', 0)).map(e => e.event.type)).toEqual(['run.started', 'run.cancelled']);
  });

  it('URL-encodes model-supplied ids in Google API paths', async () => {
    const urls: string[] = [];
    const client = { request: async (o: { url: string }) => { urls.push(o.url); return { data: { id: 'x', start: {}, end: {} } }; } };
    const g = googleConnectors(client as never);
    await g.calendar.get('evt?sendUpdates=all&x=../../drive/v3/files/abc');
    await g.drive.get('../evil');
    expect(urls[0]).toMatch(/\/events\/evt%3FsendUpdates%3Dall%26x%3D..%2F..%2Fdrive%2Fv3%2Ffiles%2Fabc$/);
    expect(urls[1]).toMatch(/\/files\/..%2Fevil$/);
  });

  it('refuses to start in production with the dev session secret', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(registerB1(Fastify(), { pets: stubPets, media: stubMedia })).rejects.toThrow(/SESSION_SECRET/);
      await expect(registerB1(Fastify(), { pets: stubPets, media: stubMedia, config: { sessionSecret: 'real-secret' } })).resolves.toBeTruthy();
    } finally { process.env.NODE_ENV = prev; }
  });
});
