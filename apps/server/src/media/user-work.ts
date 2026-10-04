import { ApiError } from '../errors.js';

// Prevent in-flight uploads/generation from recreating user data during deletion.
export class UserWork {
  private closed = false;
  private deletions = new Set<Promise<unknown>>();
  private states = new Map<string, { active: number; deleting: boolean; drained?: () => void }>();
  enter(userId: string) {
    if (this.closed) throw new ApiError(503, 'server_closing');
    let state = this.states.get(userId);
    if (!state) { state = { active: 0, deleting: false }; this.states.set(userId, state); }
    if (state.deleting) throw new ApiError(409, 'data_deletion_pending', 'Please wait until data deletion finishes');
    state.active++;
    let released = false;
    return () => {
      if (released) return; released = true; state.active--;
      if (!state.active) {
        if (state.deleting) state.drained?.(); else this.states.delete(userId);
      }
    };
  }
  async delete<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    if (this.closed) throw new ApiError(503, 'server_closing');
    let state = this.states.get(userId);
    if (!state) { state = { active: 0, deleting: false }; this.states.set(userId, state); }
    if (state.deleting) throw new ApiError(409, 'data_deletion_pending');
    state.deleting = true;
    const deletion = (async () => {
      try {
        if (state.active) await new Promise<void>(resolve => { state.drained = resolve; });
        return await fn();
      } finally { this.states.delete(userId); }
    })();
    this.deletions.add(deletion);
    try { return await deletion; } finally { this.deletions.delete(deletion); }
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.states.values()].filter(state => state.active > 0).map(state => {
      state.deleting = true;
      return new Promise<void>(resolve => {
        const previous = state.drained;
        state.drained = () => { previous?.(); resolve(); };
      });
    }));
    await Promise.allSettled([...this.deletions]);
  }
}
