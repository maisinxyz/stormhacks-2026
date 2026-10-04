// Persists run events (so SSE can replay) and fans them out to live subscribers.
// Emits are serialized per run, so seq order always equals emit order.
import { EventEmitter } from 'node:events';
import type { B1Store } from './store';
import type { RunEvent } from './types';

export interface Sequenced { seq: number; event: RunEvent }

export const isTerminal = (e: RunEvent) => e.type === 'run.result' || e.type === 'run.error' || e.type === 'run.cancelled';

export class RunHub {
  private emitter = new EventEmitter().setMaxListeners(0);
  private chains = new Map<string, Promise<unknown>>();
  private ended = new Set<string>();

  constructor(private store: B1Store) {}

  /** Nothing is recorded after a terminal event, so a finished stream stays finished. Returns -1 if dropped. */
  emit(runId: string, event: RunEvent): Promise<number> {
    if (this.ended.has(runId)) return Promise.resolve(-1);
    if (isTerminal(event)) this.ended.add(runId);
    const next = (this.chains.get(runId) ?? Promise.resolve()).then(async () => {
      const seq = await this.store.appendEvent(runId, event);
      this.emitter.emit(runId, { seq, event } satisfies Sequenced);
      return seq;
    });
    const settled = next.then(() => undefined, () => undefined);
    this.chains.set(runId, settled);
    if (isTerminal(event)) void settled.then(() => { if (this.chains.get(runId) === settled) this.chains.delete(runId); });
    return next;
  }

  subscribe(runId: string, fn: (e: Sequenced) => void): () => void {
    this.emitter.on(runId, fn);
    return () => this.emitter.off(runId, fn);
  }
}
