import { afterEach, describe, expect, it } from 'vitest';
import { mockBrain } from './mockBrain';
import { buildB1App } from './testApp';

type App = Awaited<ReturnType<typeof buildB1App>>;
let a: App | undefined;
afterEach(async () => { await a?.app.close(); a = undefined; });

interface Frame { event?: string; data: any }

/** Streams SSE frames into `frames` until aborted. */
function listen(url: string) {
  const frames: Frame[] = [];
  const ctrl = new AbortController();
  const done = (async () => {
    const res = await fetch(url, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.match(/^data: (.*)$/m);
          if (data) frames.push({ event: chunk.match(/^event: (.*)$/m)?.[1], data: JSON.parse(data[1]) });
        }
      }
    } catch { /* aborted */ }
  })();
  return { frames, stop: async () => { ctrl.abort(); await done; } };
}
const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); }
};

describe('/notifications/stream', () => {
  it('sends unread mail and upcoming meetings, then new arrivals, deduped; pauses in Play mode', async () => {
    a = await buildB1App({
      brain: mockBrain(0),
      config: { mockConnectors: true, demoUserId: 'notify-user' },
      notify: { pollMs: 40, mockArrivalMs: 150 },
    });
    const base = await a.app.listen({ port: 0, host: '127.0.0.1' });
    const s = listen(`${base}/notifications/stream`);
    const notices = () => s.frames.filter(f => !f.event).map(f => f.data);

    await until(() => notices().length >= 3);
    expect(s.frames[0]).toEqual({ event: 'status', data: { paused: false, connected: true } });
    const kinds = notices().map(n => n.kind);
    expect(kinds).toContain('meeting');                       // "Product sync" in ~18 min
    expect(notices().find(n => n.kind === 'meeting').detail).toMatch(/^Product sync · in \d+ min$/);
    expect(notices().filter(n => n.kind === 'email').map(n => n.detail)).toEqual(
      expect.arrayContaining([expect.stringContaining('Alex Morgan · Standup notes')]),
    );

    await until(() => notices().some(n => /Lunch after the demo/.test(n.detail)));
    const ids = notices().map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);               // no duplicates across polls

    await a.app.inject({ method: 'POST', url: '/mode', payload: { mode: 'play' } });
    await until(() => s.frames.some(f => f.event === 'status' && f.data.paused === true));
    const countWhilePaused = notices().length;
    const mailbox = (await import('../connectors/mock')).mockWorkspace('notify-user');
    mailbox.emails.push({ ...mailbox.emails[0], id: 'msg-during-play', subject: 'During play', date: new Date().toISOString(), unread: true });
    await new Promise(r => setTimeout(r, 200));
    expect(notices().length).toBe(countWhilePaused);          // nothing delivered in Play mode

    await a.app.inject({ method: 'POST', url: '/mode', payload: { mode: 'work' } });
    await until(() => notices().some(n => n.id === 'email:msg-during-play'));
    await s.stop();
  });
});
