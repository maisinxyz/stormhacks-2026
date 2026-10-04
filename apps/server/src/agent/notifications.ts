// GET /notifications/stream (PRD B1.2, F2 2.7): new unread email and upcoming meetings, Work mode only.
// Notices are unnamed SSE frames shaped like F2's NotificationItem; `event: status` frames report
// paused (Play mode) / connected state.
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/requireUser';
import { connectorsFor } from '../connectors';
import { mockWorkspace } from '../connectors/mock';
import { DEMO_EMAIL } from '../connectors/seed';
import type { Connectors } from '../connectors/types';
import type { B1Context } from './context';
import { openSse } from './sse';
import type { Mode } from './types';

export interface NotificationItem {
  id: string; kind: 'email' | 'meeting'; title: string; detail: string;
  time: string;   // display time, e.g. "9:42 AM"
  at: string;     // ISO timestamp
  unread: boolean;
}

export interface NotifyOptions {
  pollMs: number;
  /** Look-back for unread email on connect. */
  initialWindowMs: number;
  meetingLeadMs: number;
  /** MOCK_CONNECTORS only: a new email "arrives" this long after connecting (0 = never). */
  mockArrivalMs: number;
}

const DEFAULTS: NotifyOptions = {
  pollMs: Number(process.env.NOTIFY_POLL_MS ?? 30_000),
  initialWindowMs: 24 * 3_600_000,
  meetingLeadMs: 30 * 60_000,
  mockArrivalMs: Number(process.env.MOCK_NOTIFY_ARRIVAL_MS ?? 20_000),
};

const displayTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const senderName = (from: string) => from.replace(/\s*<.*>$/, '').replace(/"/g, '') || from;

async function collect(c: Connectors, sinceMs: number, leadMs: number): Promise<NotificationItem[]> {
  const now = Date.now();
  const [mail, events] = await Promise.all([
    c.gmail.listUnread(sinceMs),
    c.calendar.list({ from: new Date(now).toISOString(), to: new Date(now + leadMs).toISOString() }),
  ]);
  return [
    ...mail.map(m => ({
      id: `email:${m.id}`, kind: 'email' as const, title: 'New unread email',
      detail: `${senderName(m.from)} · ${m.subject}`, time: displayTime(m.date), at: m.date, unread: true,
    })),
    ...events.map(e => ({
      id: `meeting:${e.id}:${e.start}`, kind: 'meeting' as const, title: 'Upcoming meeting',
      detail: `${e.title} · in ${Math.max(1, Math.round((Date.parse(e.start) - now) / 60_000))} min`,
      time: displayTime(e.start), at: e.start, unread: true,
    })),
  ];
}

export async function notificationRoutes(app: FastifyInstance, ctx: B1Context, overrides: Partial<NotifyOptions> = {}) {
  const opts = { ...DEFAULTS, ...overrides };
  const auth = requireUser(ctx.config, ctx.store);

  app.get('/notifications/stream', { preHandler: auth }, async (req, reply) => {
    const userId = req.user!.id;
    const sse = openSse(req, reply);
    const seen = new Set<string>();
    let since = Date.now() - opts.initialWindowMs;
    let mode: Mode = (await ctx.store.getUserState(userId)).mode;
    let polling = false;

    // Named event: EventSource `onmessage` only sees notices; status needs addEventListener('status').
    const sendStatus = (extra: Record<string, unknown> = {}) => sse.write(undefined, { paused: mode !== 'work', ...extra }, 'status');

    const poll = async () => {
      if (mode !== 'work' || polling) return;
      polling = true;
      try {
        const connectors = await connectorsFor(ctx, userId);
        const pollStart = Date.now();
        for (const n of await collect(connectors, since, opts.meetingLeadMs)) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          sse.write(n.id, n);
        }
        since = pollStart - opts.pollMs;   // overlap one interval; `seen` dedupes
      } catch (err) {
        sendStatus({ connected: false, error: (err as { code?: string }).code ?? 'unavailable' });
      } finally { polling = false; }
    };

    const onMode = (uid: string, m: Mode) => {
      if (uid !== userId || m === mode) return;
      mode = m;
      sendStatus();
      if (mode === 'work') void poll();
    };
    ctx.modeEvents.on('mode', onMode);
    sse.onClose(() => ctx.modeEvents.off('mode', onMode));
    const timer = setInterval(poll, opts.pollMs);
    sse.onClose(() => clearInterval(timer));

    if (ctx.config.mockConnectors && opts.mockArrivalMs > 0) {
      const arrival = setTimeout(() => {
        const ws = mockWorkspace(userId);
        const id = `msg-new-${Date.now()}`;
        ws.emails.push({
          id, threadId: id, from: 'Priya Shah <priya@fetch.demo>', to: [DEMO_EMAIL], cc: [], subject: 'Lunch after the demo?',
          snippet: 'Want to grab lunch after the demo?', body: 'Want to grab lunch after the demo? - Priya',
          date: new Date().toISOString(), unread: true,
        });
        void poll();
      }, opts.mockArrivalMs);
      sse.onClose(() => clearTimeout(arrival));
    }

    sendStatus({ connected: true });
    await poll();
  });
}
