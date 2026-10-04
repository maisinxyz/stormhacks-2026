// Approval policy (PRD B1.4): the exact payload is stored and hashed when the run pauses;
// only an approve that matches actionId + contentHash executes it, once.
import { createHash, timingSafeEqual } from 'node:crypto';

/** Deterministic JSON (sorted keys) so equal payloads always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(runId: string, actionId: string, tool: string, payload: unknown): string {
  return createHash('sha256').update(canonicalJson({ runId, actionId, tool, payload })).digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** `actionId` is the approval the decision applies to (an edit may have replaced the original). */
export interface Decision { decision: 'approved' | 'denied' | 'expired' | 'cancelled'; actionId: string }

/** One pending decision per run; the runner awaits it, the HTTP routes resolve it. */
export class ApprovalGate {
  private waiters = new Map<string, { done: (d: Pick<Decision, 'decision'>) => void; actionId: string; timer: NodeJS.Timeout }>();

  wait(runId: string, actionId: string, ttlMs: number, signal: AbortSignal): Promise<Decision> {
    return new Promise(resolve => {
      const done = (d: Pick<Decision, 'decision'>) => {
        const entry = this.waiters.get(runId);
        clearTimeout(entry?.timer); signal.removeEventListener('abort', onAbort);
        this.waiters.delete(runId);
        resolve({ decision: d.decision, actionId: entry?.actionId ?? actionId });
      };
      const onAbort = () => done({ decision: 'cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(runId, { done, actionId, timer: setTimeout(() => done({ decision: 'expired' }), ttlMs) });
    });
  }

  resolve(runId: string, d: Pick<Decision, 'decision'>): boolean {
    const w = this.waiters.get(runId);
    if (!w) return false;
    w.done(d);
    return true;
  }

  /** The actionId currently awaiting a decision for this run (changes when an edit re-requests approval). */
  pendingAction(runId: string) { return this.waiters.get(runId)?.actionId; }

  /** Swaps in a re-issued approval and restarts its expiry clock. */
  setPendingAction(runId: string, actionId: string, ttlMs: number) {
    const w = this.waiters.get(runId);
    if (!w) return false;
    clearTimeout(w.timer);
    w.actionId = actionId;
    w.timer = setTimeout(() => w.done({ decision: 'expired' }), ttlMs);
    return true;
  }
}
