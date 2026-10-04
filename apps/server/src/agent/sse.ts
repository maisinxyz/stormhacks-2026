// SSE transport for run events (PRD B1.2): `id:` is the per-run seq so EventSource resumes
// via Last-Event-ID with no duplicates or gaps. Frames are unnamed so `onmessage` receives them.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isTerminal, type RunHub, type Sequenced } from './hub';
import type { B1Store } from './store';

export function openSse(req: FastifyRequest, reply: FastifyReply) {
  reply.hijack();
  const raw = reply.raw;
  // Keep headers set by earlier hooks (e.g. B2's CORS middleware); hijack bypasses reply.send.
  raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write('retry: 2000\n\n');
  const heartbeat = setInterval(() => raw.write(': ping\n\n'), 15_000);
  let closed = false;
  const cleanups: (() => void)[] = [() => clearInterval(heartbeat)];
  const close = () => {
    if (closed) return;
    closed = true;
    cleanups.forEach(f => f());
    raw.end();
  };
  req.raw.on('close', close);
  return {
    write: (id: string | number | undefined, data: unknown) => {
      if (!closed) raw.write(`${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
    },
    onClose: (f: () => void) => cleanups.push(f),
    close,
  };
}

export function lastEventId(req: FastifyRequest): number {
  const header = req.headers['last-event-id'];
  const query = (req.query as { lastEventId?: string })?.lastEventId;
  const n = Number(Array.isArray(header) ? header[0] : header ?? query ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function streamRun(req: FastifyRequest, reply: FastifyReply, hub: RunHub, store: B1Store, runId: string, finished: boolean) {
  const after = lastEventId(req);
  // A finished run with nothing new: 204 tells EventSource to stop reconnecting.
  if (finished && (await store.listEvents(runId, after)).length === 0) return reply.code(204).send();

  const sse = openSse(req, reply);
  let last = after;
  let replaying = true;
  const buffered: Sequenced[] = [];
  const write = (e: Sequenced) => {
    if (e.seq <= last) return;            // dedupe replay vs live overlap
    last = e.seq;
    sse.write(e.seq, e.event);
    if (isTerminal(e.event)) sse.close();
  };
  // Subscribe before reading history so nothing emitted in between is lost.
  sse.onClose(hub.subscribe(runId, e => (replaying ? buffered.push(e) : write(e))));
  for (const e of await store.listEvents(runId, after)) write({ seq: e.seq, event: e.event });
  replaying = false;
  buffered.sort((a, b) => a.seq - b.seq).forEach(write);
}
