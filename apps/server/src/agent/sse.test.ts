import { afterEach, describe, expect, it } from 'vitest';
import { mockBrain } from './mockBrain';
import { buildB1App } from './testApp';

type App = Awaited<ReturnType<typeof buildB1App>>;
let a: App | undefined;
afterEach(async () => { await a?.app.close(); a = undefined; });

interface Frame { id: number; data: { type: string } }

/** Reads SSE frames until `stopAfter` frames or the stream ends. */
async function readFrames(url: string, headers: Record<string, string>, stopAfter = Infinity) {
  const ctrl = new AbortController();
  const res = await fetch(url, { headers, signal: ctrl.signal });
  const frames: Frame[] = [];
  if (res.status !== 200) return { status: res.status, frames };
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (frames.length < stopAfter) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0 && frames.length < stopAfter) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const id = chunk.match(/^id: (\d+)$/m); const data = chunk.match(/^data: (.*)$/m);
        if (id && data) frames.push({ id: Number(id[1]), data: JSON.parse(data[1]) });
      }
    }
  } finally { ctrl.abort(); }
  return { status: res.status, frames };
}

describe('SSE /agent/runs/:id/events', () => {
  it('resumes with Last-Event-ID without duplicates or gaps', async () => {
    a = await buildB1App({ brain: mockBrain(40), config: { mockConnectors: true, demoUserId: 'sse-user' } });
    const base = await a.app.listen({ port: 0, host: '127.0.0.1' });
    const { runId } = await (await fetch(`${base}/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ petId: 'bird', text: 'find my budget sheet' }),
    })).json() as { runId: string };

    const first = await readFrames(`${base}/agent/runs/${runId}/events`, {}, 3);
    expect(first.frames.map(f => f.id)).toEqual([1, 2, 3]);
    expect(first.frames[0].data.type).toBe('run.started');

    // Reconnect mid-run, as EventSource does after a drop.
    const rest = await readFrames(`${base}/agent/runs/${runId}/events`, { 'Last-Event-ID': '3' });
    const all = [...first.frames, ...rest.frames];
    expect(all.map(f => f.id)).toEqual(all.map((_, i) => i + 1));
    expect(all.at(-1)!.data.type).toBe('run.result');

    const stored = await a.ctx.store.listEvents(runId, 0);
    expect(all.map(f => f.data)).toEqual(stored.map(e => e.event));
  });

  it('replays everything for a finished run, then 204 once caught up', async () => {
    a = await buildB1App({ brain: mockBrain(0), config: { mockConnectors: true, demoUserId: 'sse-user-2' } });
    const base = await a.app.listen({ port: 0, host: '127.0.0.1' });
    const { runId } = await (await fetch(`${base}/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ petId: 'dog', text: 'check my calendar' }),
    })).json() as { runId: string };
    const full = await readFrames(`${base}/agent/runs/${runId}/events`, {});
    expect(full.frames.at(-1)!.data.type).toBe('run.result');
    const lastId = String(full.frames.at(-1)!.id);
    expect((await readFrames(`${base}/agent/runs/${runId}/events`, { 'Last-Event-ID': lastId })).status).toBe(204);
    // Query-param form for clients that can't set headers.
    expect((await readFrames(`${base}/agent/runs/${runId}/events?lastEventId=${lastId}`, {})).status).toBe(204);
  });

  it('404s for unknown runs', async () => {
    a = await buildB1App({ brain: mockBrain(0), config: { mockConnectors: true } });
    expect((await a.app.inject({ method: 'GET', url: '/agent/runs/run_nope/events' })).statusCode).toBe(404);
  });
});
