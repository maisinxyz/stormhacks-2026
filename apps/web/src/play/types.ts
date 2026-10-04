import type { Engine } from '../engine';
import type { PetBundle } from '@fetch/contracts';

export type PlayViewId = 'room' | 'camera';
export interface PetSession { bundle: PetBundle; position: { x: number; z: number }; heading: number; scale: number; muted: boolean; quality: 'low' | 'high'; lastView: PlayViewId; }
export type ShellErrorCode = 'camera_denied' | 'camera_unavailable' | 'orientation_denied' | 'webgl_lost' | 'asset_failed';
export type ShellEvent =
  | { type: 'view.entering'; view: PlayViewId }
  | { type: 'view.entered'; view: PlayViewId }
  | { type: 'view.error'; view: PlayViewId; code: ShellErrorCode; message: string };
export interface PlayContext { engine: Engine; session: PetSession; root: HTMLElement; canvas: HTMLCanvasElement; switchTo(view: PlayViewId): void; exit(): void; emit?(event: ShellEvent): void; }
export interface PlayView {
  readonly id: PlayViewId;
  /** Called synchronously inside the user's tap, before any await, so permission prompts (iOS motion, camera) keep their user gesture. */
  prepare?(ctx: PlayContext): void;
  /** May reject (e.g. the camera cannot start): the shell then keeps the previous view. */
  enter(ctx: PlayContext, from?: PlayViewId): Promise<void>;
  exit(): Promise<void> | void;
  /** `frame` is set while a WebXR session is presenting. */
  update(dt: number, frame?: XRFrame): void;
  resize(width: number, height: number): void;
}
