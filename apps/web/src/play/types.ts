import type { Engine } from '../engine';
import type { PetBundle } from '@fetch/contracts';

export type PlayViewId = 'room' | 'camera';
export interface PetSession { bundle: PetBundle; position: { x: number; z: number }; heading: number; scale: number; muted: boolean; quality: 'low' | 'high'; lastView: PlayViewId; }
export type ShellEvent =
  | { type: 'view.entering'; view: PlayViewId }
  | { type: 'view.entered'; view: PlayViewId }
  | { type: 'view.error'; view: PlayViewId; code: 'camera_denied' | 'camera_unavailable' | 'orientation_denied' | 'webgl_lost' | 'asset_failed'; message: string };
export interface PlayContext { engine: Engine; session: PetSession; root: HTMLElement; canvas: HTMLCanvasElement; switchTo(view: PlayViewId): void; exit(): void; emit?(event: ShellEvent): void; }
export interface PlayView { readonly id: PlayViewId; enter(ctx: PlayContext, from?: PlayViewId): Promise<void>; exit(): Promise<void> | void; update(dt: number): void; resize(width: number, height: number): void; }
