// B1 persistence (PRD B1.6). The interface is async so B2's DB can back it; the in-memory
// implementation is the default and is what tests and MOCK runs use. Matching DDL: schema.sql.
import type {
  Approval, ApprovalStatus, ConnectorToken, Run, RunEvent, StoredEvent, UndoEntry, User, UserState,
} from './types';

export interface B1Store {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: User): Promise<void>;

  getUserState(userId: string): Promise<UserState>;
  setUserState(userId: string, patch: Partial<UserState>): Promise<UserState>;

  getToken(userId: string, provider: 'google'): Promise<ConnectorToken | undefined>;
  putToken(token: ConnectorToken): Promise<void>;
  deleteToken(userId: string, provider: 'google'): Promise<void>;

  createRun(run: Run): Promise<void>;
  getRun(id: string): Promise<Run | undefined>;
  updateRun(id: string, patch: Partial<Run>): Promise<void>;

  /** Appends and returns the event's sequence number (1-based, per run). */
  appendEvent(runId: string, event: RunEvent): Promise<number>;
  listEvents(runId: string, afterSeq: number): Promise<StoredEvent[]>;

  createApproval(a: Approval): Promise<void>;
  getApproval(actionId: string): Promise<Approval | undefined>;
  /** Atomic compare-and-set on status; returns false if the approval was not in `from`. */
  transitionApproval(actionId: string, from: ApprovalStatus, to: ApprovalStatus): Promise<boolean>;

  recordUndo(entry: UndoEntry): Promise<void>;
}

const now = () => new Date().toISOString();

export class MemoryStore implements B1Store {
  private users = new Map<string, User>();
  private states = new Map<string, UserState>();
  private tokens = new Map<string, ConnectorToken>();
  private runs = new Map<string, Run>();
  private events = new Map<string, StoredEvent[]>();
  private approvals = new Map<string, Approval>();
  readonly undoLog: UndoEntry[] = [];

  async getUser(id: string) { return this.users.get(id); }
  async upsertUser(user: User) { this.users.set(user.id, { ...this.users.get(user.id), ...user }); }

  async getUserState(userId: string) { return { ...(this.states.get(userId) ?? { mode: 'work' as const }) }; }
  async setUserState(userId: string, patch: Partial<UserState>) {
    const next = { ...(await this.getUserState(userId)), ...patch };
    this.states.set(userId, next);
    return { ...next };
  }

  async getToken(userId: string, provider: 'google') { return this.tokens.get(`${userId}:${provider}`); }
  async putToken(token: ConnectorToken) { this.tokens.set(`${token.userId}:${token.provider}`, token); }
  async deleteToken(userId: string, provider: 'google') { this.tokens.delete(`${userId}:${provider}`); }

  async createRun(run: Run) { this.runs.set(run.id, structuredClone(run)); this.events.set(run.id, []); }
  async getRun(id: string) { const r = this.runs.get(id); return r && structuredClone(r); }
  async updateRun(id: string, patch: Partial<Run>) {
    const r = this.runs.get(id);
    if (r) this.runs.set(id, { ...r, ...structuredClone(patch), updatedAt: now() });
  }

  async appendEvent(runId: string, event: RunEvent) {
    const list = this.events.get(runId) ?? [];
    const seq = list.length + 1;
    list.push({ runId, seq, event: structuredClone(event), at: now() });
    this.events.set(runId, list);
    return seq;
  }
  async listEvents(runId: string, afterSeq: number) {
    return (this.events.get(runId) ?? []).filter(e => e.seq > afterSeq).map(e => structuredClone(e));
  }

  async createApproval(a: Approval) { this.approvals.set(a.actionId, structuredClone(a)); }
  async getApproval(actionId: string) { const a = this.approvals.get(actionId); return a && structuredClone(a); }
  async transitionApproval(actionId: string, from: ApprovalStatus, to: ApprovalStatus) {
    const a = this.approvals.get(actionId);
    if (!a || a.status !== from) return false;
    a.status = to; a.decidedAt = now();
    return true;
  }

  async recordUndo(entry: UndoEntry) { this.undoLog.push(entry); }
}
