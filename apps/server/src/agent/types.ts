// B1 server-side types. Wire types (RunEvent, ActionStep, ...) come from @fetch/contracts.
import type { ActionStep, Mode, Mood, RunEvent, Species, PetBundle } from '@fetch/contracts';

export type ApprovalKind = Extract<RunEvent, { type: 'approval.required' }>['kind'];
export type ApprovalPreview = Extract<RunEvent, { type: 'approval.required' }>['preview'];

export interface User { id: string; name: string; email?: string; createdAt: string }

export interface UserState { mode: Mode; activePetId?: string }

export interface ConnectorToken {
  userId: string;
  provider: 'google';
  email?: string;
  scopes: string[];
  encRefreshToken: string;   // AES-256-GCM, see auth/crypto.ts
  updatedAt: string;
}

export type RunStatus = 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'denied' | 'cancelled';
export const TERMINAL_STATUSES: RunStatus[] = ['succeeded', 'failed', 'denied', 'cancelled'];

export interface Run {
  id: string; userId: string; petId: string; text: string;
  status: RunStatus;
  steps: ActionStep[];
  createdAt: string; updatedAt: string;
}

export interface StoredEvent { runId: string; seq: number; event: RunEvent; at: string }

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'superseded';

export interface Approval {
  actionId: string; runId: string; userId: string; stepId: string;
  tool: string;
  kind: ApprovalKind;
  payload: Record<string, unknown>;   // exact input that will execute on approve
  preview: ApprovalPreview;
  contentHash: string;
  status: ApprovalStatus;
  createdAt: string; expiresAt: string; decidedAt?: string;
}

export interface UndoEntry { runId: string; tool: string; undo: Record<string, unknown>; at: string }

/** Pet context B1 needs; provided by B2's PetsRepo (PRD B2.3). */
export interface PetInfo { id: string; name: string; species: Species; personality: PetBundle['personality'] }
export interface PetsRepo { get(petId: string): Promise<PetInfo> }
/** B2's prop sticker generator (PRD B2.3). */
export interface MediaService { generateProp(prompt: string): Promise<{ imageUrl: string }> }

export type { ActionStep, Mode, Mood, RunEvent };
