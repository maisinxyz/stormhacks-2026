// Shared Play-shell contracts (play.md 0.7). Frozen once both views build against them.
import type { PetBundle } from '@fetch/contracts';
import type { Engine } from '../engine';

export type PlayViewId = 'room' | 'camera';

/** Anything the shell can show. Room (Person A) and Camera (Person B) implement this. */
export interface PlayView {
  readonly id: PlayViewId;
  /** View becomes active: add layers, bind input, take the camera. May be async (permissions, assets). */
  enter(ctx: PlayContext, from?: PlayViewId): Promise<void>;
  /** Leaving: release input handlers and streams, hide overlay UI. Must not dispose the engine or the pet. */
  exit(): Promise<void> | void;
  /** Per-frame hook, before the engine renders. dt in seconds. */
  update(dt: number, frame?: XRFrame): void; // frame is set while a WebXR session is presenting
  resize(width: number, height: number): void;
}

export interface PlayContext {
  engine: Engine;
  session: PetSession;
  /** Full-viewport container holding everything. */
  stage: HTMLElement;
  /** Where a view puts its background layer (camera video, room). Sits under the transition curtain and the engine canvas. */
  background: HTMLElement;
  /** Overlay container for the view's controls (above the canvas). */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  switchTo(view: PlayViewId): void;
  /** Leave Play and return to the Desk. */
  exit(): void;
  emit(e: ShellEvent): void;
}

/** Survives view switches; the shell owns it. */
export interface PetSession {
  bundle: PetBundle;
  position: { x: number; z: number }; // metres on the floor, origin = room centre / AR anchor
  heading: number;                    // yaw, radians
  scale: number;                      // multiplier on the view's default pet size (pinch)
  quality: 'low' | 'high';
  lastView: PlayViewId;
}

export type ShellErrorCode = 'camera_denied' | 'camera_unavailable' | 'orientation_denied' | 'webgl_lost' | 'asset_failed';
export type ShellEvent =
  | { type: 'view.entering'; view: PlayViewId }
  | { type: 'view.entered'; view: PlayViewId }
  | { type: 'view.error'; view: PlayViewId; code: ShellErrorCode; message: string };
