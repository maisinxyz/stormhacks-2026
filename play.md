# Fetch Play — Product Requirements Document (2-Person Split)

**One-liner:** Pressing **Play** drops you into your pet's own little 3D home: a cozy room you can orbit, where the splat dog lives, roams, sleeps, eats and plays, and where you still pet it, feed it, throw its ball and talk to it. A **camera button** turns that same dog into a **Snapchat-style camera companion**: the phone's rear camera fills the screen and the dog stands inside your real room, alive, reacting to your taps, voice and movement.

**Relationship to `PRD.md`:** this document extends the Play mode defined there (connectors off, pure fun). It reuses the F1 engine (`apps/web/src/engine`) and the existing Play behavior. It adds a phone-first, full-screen **Play shell** with two views, **Room** and **Camera**. Nothing here changes the Work-mode agent path.

**People:**

| Person | Section | Owns |
|---|---|---|
| **Person A: Room** | Part A | The simulated 3D room: scene, orbit camera, 3D floor movement for the pet, furniture spots, depth occlusion, room UI and room interactions |
| **Person B: Camera** | Part B | The Snapchat-style camera view: camera stack, gyro pseudo-AR, optional WebXR, look-at and alive layer, ambient integration effects, capture, camera UI |

Shared work (Part 0) is the Play shell, the view-switching contract, and the pet session handoff. It is built in the first two hours by both people together and then frozen.

---

## PART 0: SHARED (both read this)

### 0.1 Product flow

```
Desk (apps/desk)  --[Play]-->  Play shell (apps/web/camera.html?pet=<id>)
                                   │
                                   ├── ROOM view (default on entry)   <-- Person A
                                   │      orbit the room, play with the dog
                                   │      [camera button] ──────────────┐
                                   │                                    ▼
                                   └── CAMERA view                   <-- Person B
                                          full-screen rear camera + dog in your world
                                          [back button] ──► ROOM view
                              [close/back in ROOM] ──► Desk
```

Rules:
1. **Room is always the first screen** after pressing Play.
2. **One persistent dog.** Switching views never reloads the pet. Needs, mood, current animation state and carried props survive the switch.
3. Every screen has an obvious way back: Camera → Room → Desk.
4. Play mode semantics from `PRD.md` hold: no connector calls, no errands in this view (the Work-mode errand path is out of scope here). Local intents, voice commands, petting, feeding and toys all work.
5. Phone first (portrait). Desktop works for development (mouse stands in for touch, a fake video feed stands in for the camera).

### 0.2 Goals
- Pressing Play shows a living 3D room within 3 seconds on a mid-range phone.
- The user can orbit and zoom the room with touch while the dog keeps living its life.
- Every existing interaction (stroke, poke, feed, ball, point, voice intents) works in the room.
- A camera button transitions to the camera view in about 0.5 seconds without reloading the pet.
- In the camera view the dog looks like it stands in the user's real environment: believable scale, ground contact, and it stays anchored while the phone turns.
- The dog is never frozen. It breathes, looks around, wags, reacts to taps, voice and phone movement.
- 30+ fps on a mid-range phone at the `low` quality preset.

### 0.3 Non-goals
- Work mode, connectors and errands inside the Play shell.
- True plane detection, occlusion or world mapping on iOS (browsers do not offer it). Android WebXR is a stretch tier, not a requirement.
- Multiplayer, saving room layouts, furniture placement or decorating (the room is fixed for this version).
- Video recording of the camera view (photo capture only).
- Real photo-to-splat generation. That is owned by `PRD.md` (F1/B2). Play uses whatever bundle `loadPet` is given: the placeholder dog and bird bundles now, real generated pets later.

### 0.4 Platform assumptions
- **Targets:** iOS Safari (latest) and Android Chrome (latest). WebGL2 required.
- **HTTPS is mandatory on a phone** for camera, microphone and device orientation. `localhost` only counts on the same machine. For on-device testing use a LAN HTTPS dev server (`@vitejs/plugin-basic-ssl`, `vite --host`). A tunnel is the fallback if the venue Wi-Fi blocks device-to-device traffic.
- **iOS gesture rules:**
  - `DeviceOrientationEvent.requestPermission()` must be called inside a user gesture. Use the camera-button tap.
  - `<video>` needs `playsinline muted autoplay`.
  - Audio is locked until the first tap.
- **Android:** WebXR `immersive-ar` is available on supported Chrome devices (feature-detect, never assume).
- **Performance defaults:** quality `low` (120k splat budget), render scale 1.0 to 1.25, 30 fps target. The engine already auto-degrades (render scale first, then budget) when fps stays under 24 for 3 seconds.

### 0.5 What already exists and must be reused (do not rebuild)

All paths relative to `apps/web/src/engine/` unless noted.

| Piece | File | Use in Play |
|---|---|---|
| `Engine` class: `mount`, `loadPet`, `setMode`, `doIntent`, `react`, `previewVerb`, `setListening`, `spawnBall`, `dropFood`, `pointAt`, `onStats`, `setQuality`, `hitTest` | `index.ts` | The single engine instance shared by both views |
| Splat renderer with GPU skinning, texture-backed data, O(n) depth sort, quality budget | `splatRenderer.ts` | Renders the dog in both views |
| Behavior state machine (idle, listening, play, sleep, intent, reaction), generator routines, props and particles | `behavior.ts`, `props.ts` | The dog's life; extended (see A.6 and B.6) |
| Species packs (dog and bird fully authored, 13 verbs, 28/19 clips, `idleList`, `intents`, `reactions`) | `species/*` | All dog animation |
| Needs (energy, happiness, hunger) and mood | `needs.ts` | Drives furniture choices and mood |
| Pointer interactions: stroke, poke, ball flick (`THROW`), food drop (`FEED`), point (`POINT`), cursor tracking, pet-to-approve | `interactions.ts`, `toys.ts` | Same interactions in both views |
| Skeleton (posable bones) | `skeleton.ts` | Look-at layer (head bone override) |
| Edge-peek scene | `peek.ts` | Not used in Play (no errands) |
| Voice pipeline and local-intent parsing (F2) | `apps/desk/src/voice.ts` | Microphone button in both views → `engine.doIntent` |
| Placeholder bundles | `apps/web/public/bundles/{dog,bird}/bundle.json` | Default pet (`bundle.json` = a `PetBundle`) |
| Acceptance harness | `apps/web/src/acceptance.ts` (`/?accept=1`) | Must keep passing |

What does **not** exist yet and is created by this PRD:
- the Play shell and its entry `apps/web/camera.html`
- `Engine.setView(...)` and an external-camera control hook
- a 3D room scene
- 3D floor movement for the pet (today `Behavior` moves only along the x axis at depth z=0)
- depth-tested splat rendering
- any camera/gyro/WebXR code

### 0.6 Repo layout (additions)

```
apps/web/
  camera.html                    (entry, Person A + B shared shell)
  src/play/
    shell.ts                     (SHARED: owns engine, renderer, view switching)
    types.ts                     (SHARED: PlayView, PetSession, transition events)
    session.ts                   (SHARED: pet session handoff)
    ui.css                       (SHARED: base tokens, safe areas)
    room/                        (PERSON A)
      room.ts, scene.ts, orbit.ts, spots.ts, ui.ts, assets/*.ts
    camera/                      (PERSON B)
      camera.ts, stream.ts, pose.ts, xr.ts, lookat.ts, tint.ts, capture.ts, ui.ts
apps/desk/src/App.tsx            (one-line change: Play toggle navigates to camera.html?pet=<id>; coordinate with F2)
```

Rules:
- Each person edits only their own folder. Changes to `src/play/` (shared), the engine files, or `apps/desk` go through the contracts in 0.7 and a short heads-up to the other person.
- Engine edits needed by one view (3D movement for A, look-at for B) are made on small, clearly named seams (see Parts A and B) so both can merge cleanly. Rebase often.

### 0.7 Shared contracts (frozen at hour 2)

```ts
// src/play/types.ts
export type PlayViewId = 'room' | 'camera';

/** Anything the shell can show. Both Room and Camera implement this. */
export interface PlayView {
  readonly id: PlayViewId;
  /** Called when the view becomes active. Add scene objects, bind input, set camera. May be async (permissions, assets). */
  enter(ctx: PlayContext, from?: PlayViewId): Promise<void>;
  /** Called when leaving. Must release input handlers, stop streams, hide overlay UI. Must not dispose the engine or pet. */
  exit(): Promise<void> | void;
  /** Per-frame hook, before the engine renders. dt in seconds. */
  update(dt: number): void;
  /** Viewport changed (rotation, resize, safe areas). */
  resize(width: number, height: number): void;
}

export interface PlayContext {
  engine: Engine;                   // the one shared engine instance
  session: PetSession;              // see below
  root: HTMLElement;                // overlay UI container for the view
  canvas: HTMLCanvasElement;        // the engine canvas
  switchTo(view: PlayViewId): void; // request a transition (shell handles crossfade)
  exit(): void;                     // leave Play and return to the Desk
}

/** Survives view switches. The shell owns it; views read and write through it. */
export interface PetSession {
  bundle: PetBundle;                // from @fetch/contracts
  /** Pet pose in the *shared play space*: metres, +Y up, origin on the floor at the room centre / AR anchor. */
  position: { x: number; z: number };
  heading: number;                  // yaw, radians
  scale: number;                    // 1 = authored (dog ~1 unit tall); views apply their own world scale
  muted: boolean;
  quality: 'low' | 'high';
  lastView: PlayViewId;
}

export type ShellEvent =
  | { type: 'view.entering'; view: PlayViewId }
  | { type: 'view.entered'; view: PlayViewId }
  | { type: 'view.error'; view: PlayViewId; code: 'camera_denied' | 'camera_unavailable' | 'orientation_denied' | 'webgl_lost' | 'asset_failed'; message: string };
```

Engine seams (all **built and merged**, `apps/web/src/engine/index.ts`):

```ts
// Shared play seams (Person A)
setView(v: 'desk' | 'room' | 'camera', opts?: { petScale?: number }): void; // room 0.55, camera 0.45 by default
setExternalCamera(on: boolean): void;       // the view owns engine.camera
get cameraRef(): THREE.PerspectiveCamera;
setOverlayScene(scene: THREE.Scene | null): void;  // room geometry rendered before the splats
setGroundPlane(y: number): void;            // plane used by toWorld / hit-tests
setSplatDepthTest(on: boolean): void;       // on in the Room, off in the camera view
setFurnitureSpots(spots): void;
claimGesture(pointerId: number): boolean; releaseGesture(pointerId: number): void;
getPetState(); applyPetState(s): void;

// Camera-view seams (Person B)
placePet(x: number, z: number, walk?: boolean): void;   // ground point in metres; walk=true walks there, false teleports
carryPet(x: number, z: number, drop?: boolean): void;   // finger-drag carry; drop=true settles it
get travelling(): boolean;                              // on its way to a placePet target
get petPosition(): THREE.Vector3;  get scaleNow(): number;  setPetScale(s: number): void;
groundPoint(px: number, py: number): THREE.Vector3 | undefined;  // screen px -> active plane
setLookAt(target: THREE.Vector3 | null): void;          // head turns toward a world point on top of any clip (B.6)
react(kind: 'pet' | 'poke' | 'feed' | 'tap'): void;     // 'tap' = affectionate tap (wag + happiness); pokes map to it in the camera view
feed(): boolean;                                        // feed the species' own food
setTint(r, g, b): void; setShadowOpacity(o: number): void;  // ambient match (B.8)
setGroundHeight(y: number): void;                       // real floor height from WebXR hit-test (B.5)
renderNow(): void;                                      // synchronous render, for capture (B.9)
get webgl(): THREE.WebGLRenderer;                       // for the WebXR session
onFrame?: (t: number, frame?: XRFrame) => void;         // loop is renderer.setAnimationLoop, so it also runs inside a WebXR session
```

**As built, the shell is Person A's** (`apps/web/src/play/session-shell.ts`, entry `src/play-entry.ts`, `camera.html`). The pet walks in world metres on the ground plane; the camera view reuses that model. `PlayContext` has `root` (which contains the engine canvas) and optional `emit`, not the `stage`/`background` fields drawn above. A view puts its background layer into `root` before the canvas, and the shell's `play-transition` overlay does the crossfade. `PlayView` gained two things the camera needs:
- `prepare?(ctx)`, called synchronously inside the user's tap, before any await, so the iOS motion-permission prompt and the camera prompt keep their user gesture (the shell's transition delay would otherwise lose it).
- `update(dt, frame?)`, where `frame` is set inside a WebXR session. A view's `enter()` may reject (for example the camera cannot start); the shell then re-enters the previous view and emits `view.error`.

Dog world scale: the splat is authored about 1 unit tall. **Room view** scales the pet to about 0.55 m tall (a medium dog relative to the room). **Camera view** uses about 0.45 m (a believable pet next to a person holding a phone), adjustable by pinch. Both set it via `setView(..., { petScale })`, never by editing the bundle.

### 0.8 Coordinate conventions
- Right-handed, +Y up, floor at y=0, units are metres.
- The pet faces +Z at yaw 0.
- Room: origin at the room centre, room is about 4 m × 4 m footprint, 2.6 m ceiling.
- Camera view: origin at the AR anchor on the floor. The user's phone starts at about (0, 1.4, 2.0) looking toward the origin (assumed camera height 1.4 m, dog about 2 m ahead).

### 0.9 Mocks and fallbacks (required)
- `?video=<url>`: replaces the live camera with a looping video (desktop dev, Playwright). **Person B.**
- `?orient=mouse`: simulates device orientation with mouse drag (desktop dev). **Person B.**
- `?room=low`: disables room extras (window rays, props) for slow devices. **Person A.**
- Placeholder dog/bird bundles are the default pet when `?pet=` is missing or a real bundle fails to load (the fallback is also the demo safety net).
- Flags are demo fallbacks: if the camera is denied, the camera button shows a one-line explanation and the user stays in the Room.

### 0.10 Integration checkpoints
- **Hour 2:** shell, `PlayView`/`PetSession` contracts and the engine seams are frozen. Room shows an empty floor + the dog; Camera shows a fake video + the dog. Both compile against the same shell.
- **Hour 8:** Room has orbit, furniture and 3D floor movement. Camera has the live feed, gyro anchoring and tap-to-place. The crossfade transition works between them.
- **Hour 14:** Room spots driven by needs; Camera look-at, capture and voice work. Everything runs on a real phone over HTTPS.
- **Hour 18:** feature freeze for the Play shell. Polish, performance and bug fixes only.
- **Hour 20+:** rehearsal and device testing.

### 0.11 Cross-cutting acceptance criteria
- [ ] Pressing Play on the Desk opens the Room view with the active pet (`?pet=<id>`); a bad id falls back to the placeholder dog with a visible notice.
- [ ] Room → Camera → Room works at least 10 times in a row with no pet reload, no leaked event listeners, and no growing memory (check with the browser's performance tools).
- [ ] The pet's needs and mood are identical before and after a view switch (±1 point).
- [ ] No third-party key or secret ships in the client bundle.
- [ ] 30+ fps on a mid-range phone in both views at the `low` preset.
- [ ] Time to first Room frame is 3 s or less on a mid-range phone on Wi-Fi (placeholder bundle).
- [ ] Camera permission denied, orientation denied, and tab backgrounded all recover without a reload.
- [ ] `/?accept=1` (existing engine acceptance run) still passes after all engine changes.
- [ ] Reduce-motion preference disables the room's ambient animation and camera transitions (falls back to a cut).

### 0.12 Demo script (90 seconds)
1. On the Desk, press **Play**. The 3D room appears with the dog lying on its bed, breathing.
2. Drag on the empty floor: the room orbits. Pinch to zoom in on the dog. Double-tap it: the view eases to focus on it.
3. Tap the dog: it looks up, wags. Say "sit": it sits. Tap the **ball** button, flick the ball: the dog chases it and brings it back.
4. Leave it alone for a few seconds: it wanders to its bowl, then back to the bed (needs drive it).
5. Tap the **camera button**. The room fades out, the live camera fades in, and the dog stands about 2 m ahead on the floor, facing you.
6. Turn the phone left and right: the dog stays anchored in the room. Tap the dog: it turns its head to you and wags. Drag it to a new spot: it walks there.
7. Say "dance". Tap **capture**: a photo of the dog in your real room is saved. Tap **back**: return to the Room, the dog continuing exactly where it was.

---

## PART A: SIMULATED ROOM (Person A)

**Goal:** a cozy, believable little home for the dog that you can look around, with the dog living in it. This is the first thing the user sees after pressing Play, so it has to feel good in the first second.

Lives in `apps/web/src/play/room/` plus the engine seams listed in A.6.

### A.1 Responsibilities
Room scene and assets, lighting and shadow, orbit camera and gesture arbitration, 3D floor movement for the pet, depth-tested rendering of the dog against room geometry, furniture spots driven by needs, room interactions and UI, the Room side of the view transition.

### A.2 The room scene
- **Footprint:** about 4 m × 4 m, ceiling 2.6 m, one open side removed (or a very low wall) so the orbit camera can always see in. Walls are fixed; the user can orbit outside them.
- **Style:** stylized, procedural low-poly built from three.js primitives (`BoxGeometry`, `CylinderGeometry`, `SphereGeometry`, `PlaneGeometry`). No external 3D files. Warm palette (cream walls, wood floor, soft fabrics) chosen to flatter the soft splat look. Color tokens live in `scene.ts` constants so the look can be re-themed.
- **Contents (all procedural, in `assets/`):**
  - Wooden plank floor (a procedural canvas texture for plank lines).
  - Walls with a baseboard.
  - A large window with a bright warm light shaft on the floor (additive plane, cheap).
  - A round rug at the centre (the "play" spot).
  - A dog bed in a corner (the "sleep" spot).
  - A food bowl and a water bowl by a wall (the "eat" spot).
  - A toy bin with the ball visible (the "ball" source).
  - A couple of props (plant, picture frame, small side table) for depth and occlusion.
- **Lighting:** the room uses `MeshLambertMaterial`/`MeshStandardMaterial` with one warm directional light + one hemisphere light. The dog is an unlit splat, so room lighting is tuned to be soft enough that the dog's baked color reads correctly. Splat tint can be nudged with a `uTint` uniform (see Part B.8) to match the room's warm light.
- **Shadows:** keep the existing blob contact shadow (`Engine.makeShadow`), scaled to the pet, plus simple blob shadows under furniture. No shadow maps (cost).
- **Budget:** the room geometry stays under about 20k triangles and 4 textures, so the splat budget is not starved. `?room=low` removes the window shaft and small props.

### A.3 Orbit camera
Owned entirely in `orbit.ts` using a plain `PerspectiveCamera` (fov about 50 in the room) driven through `Engine.setExternalCamera(true)`.

| Gesture | Result |
|---|---|
| One finger / left mouse drag on **empty space** | Orbit around the room centre (yaw 360°, pitch limited to about 8°–70°) |
| Pinch / wheel | Zoom (distance limited so the camera stays inside a sphere around the room) |
| Two-finger drag / right mouse drag | Small pan, limited to the room footprint |
| **Double-tap** the dog | Ease the orbit target to the dog and zoom to a medium close-up (about 0.6 s, cancels on any new drag) |
| **Drag that starts on the dog** | Pick up and move the dog (A.5), *not* an orbit |
| Idle for 20 s | Optional slow auto-orbit drift (off with reduce-motion) |

Details:
- Inertia on release (exponential decay), clamped zoom, no roll.
- The orbit never lets the camera clip through walls: clamp the distance by the room bounds or fade near-wall geometry.
- **Gesture arbitration (the hard part):** the engine's `Interactions` listens on `window` for pointer events. In the Room, the orbit control must not fire when a gesture starts on the dog or on the ball. Decide at `pointerdown`: `engine.hitTest(x,y)` / `hitBall(x,y)` true → engine interaction owns the gesture; otherwise orbit owns it. Orbit must still allow a drag that starts on empty space to pass over the dog without grabbing it. Add a small `Engine.claimGesture(pointerId)` seam so only one system acts per pointer.

### A.4 3D floor movement for the pet (engine change)
Today `Behavior` only moves on a 1-D x-axis (`x`, `y`) and the engine maps screen points onto the plane z=0. Part A makes the pet walk on a floor.

- Extend `Behavior` position with `z`. `walkTo(x, z)` moves along the floor with heading-based yaw (the pet faces its direction of travel; idle poses keep the existing three-quarter view toward the camera for the 2-D desk view only).
- `BehaviorHost.bounds()` returns a floor rectangle in the Room (`xmin, xmax, zmin, zmax`) with a margin from the walls and furniture footprints (circle or box obstacles). Simple steering: if the straight line crosses an obstacle, route around it via the nearest corner. No full path-finding.
- `Engine.toWorld(px, py)` and every hit-test that raycasts to the z=0 plane switch to the ground plane `y = ground` via `setGroundPlane`. The desk view keeps the old z=0 mapping through `setView`.
- Pet scale is applied by the Room via `setView('room', { petScale: 0.55 })`.
- The desk's 1-D behavior must still work (the old demo page `index.html` and `/?accept=1` are regression tests).

### A.5 Depth-correct rendering (dog vs. furniture)
Today the splat material renders with `depthTest: false`, so the dog always draws on top of anything else. In the Room the dog must be hidden when it walks behind the bed or the side table.

- Render the room first with depth writes (opaque geometry). Render the splats afterwards with `depthTest: true`, `depthWrite: false`, and `renderOrder` after the room. Splats read the room's depth buffer and are occluded correctly.
- Each splat quad uses its centre's depth, so quads can intersect surfaces slightly at contact points (feet on the floor). Mitigations: raise the pet a few millimetres, fade splat opacity near the floor plane, rely on the contact shadow, and accept minor edge artifacts (documented as a known limit).
- Provide `Engine.setSplatDepthTest(on: boolean)`. Room turns it on; the Camera view keeps it off (there is no real depth in AR).
- Blob shadows and the ball sprite use `depthTest` appropriate to their layer (ball: tested; shadow: tested, polygon-offset).

### A.6 Furniture spots (behavior)
The dog treats furniture as destinations, selected by needs and by idle roaming. All in `spots.ts` + a small extension to `Behavior`.

```ts
interface Spot {
  id: 'bed' | 'bowl' | 'rug' | 'window' | 'toybin';
  position: { x: number; z: number };      // where the pet stands
  heading: number;                          // yaw to face
  kind: 'sleep' | 'eat' | 'play' | 'watch' | 'fetch';
  clip: string;                             // from the species pack ('sleep', 'sniff'/'dig', 'playBow', 'sitWatch', ...)
  weight(stats: Stats, mood: Mood, mode: Mode): number; // selection score
}
```

Selection rule (evaluated whenever the idle routine picks its next action):
- `bed`: weight rises as energy falls (below about 40 it dominates; at 0 the existing auto-nap triggers there instead of in place).
- `bowl`: weight rises with hunger (above about 60 it dominates); eating plays the existing `feed` reaction, calls `Needs.fed()` and visibly drains the bowl sprite.
- `rug`: default play spot when happiness is below about 60 (plays `playBow`, occasionally `dance`).
- `window`: low constant weight (sits and watches), more when happy.
- `toybin`: low weight; the dog may nose the bin and bring the ball out (`spawnBall`).
- Add a hysteresis (do not flip between spots every few seconds): once a spot is chosen the dog stays 6 to 15 s.
- Spot arrival emits a lightweight event so the UI can show contextual hints.
- Needs are unchanged and keep ticking, so a neglected dog will visibly head to the bowl and the bed. They still **never block** user commands: a voice command always interrupts a spot routine.

### A.7 Interactions in the room
All existing interactions carry over unchanged because the engine is the same:

| Input | Result |
|---|---|
| Tap / click the dog | `POKE` → react (looks toward the camera, wag/startle per pack) |
| Drag back and forth on the dog | `PET_STROKE` → happiness rises, species reaction |
| Drag that **starts** on the dog and keeps moving | Pick up and move the dog; on release it walks to the drop point and settles |
| Ball button / drag from the toy bin, then flick | `THROW`; dog chases, picks up, returns it (existing fetch routine, now in 3-D) |
| Treat button → drag onto the dog | `FEED` (food check per species) |
| Tap on the floor | `POINT` → the dog walks there (existing behavior, now 3-D) |
| Mic button (push-to-talk) | Voice → local intents via the F2 pipeline → `doIntent` |
| Camera button | Switch to the Camera view (Part B) |
| Back button | Return to the Desk |

New pieces for A: a screen-to-floor raycast for drags (ground plane), picking the dog up (a small lift on the shadow while dragging, `Behavior.dragTo`), and the 3-D ball (the physics world is a 2-D plane today; see risk A.12).

### A.8 Room UI (minimal)
- Full-bleed canvas. Controls overlaid at the edges with safe-area insets, thumb-reachable, large touch targets (44 px minimum).
- **Top left:** back (to Desk). **Top right:** camera button (the primary affordance, with a short coach-mark the first time). **Bottom row:** mic (push-to-talk), ball, treat. **Top centre:** small needs readout (three icons, optional, toggled in settings).
- States: loading (pet and room assets, with a fun short message), error (asset failed, with retry and the placeholder-dog fallback), permission prompts (mic).
- Reduce motion: no auto-orbit, no camera easing (cuts).
- Accessibility: every button has a label, a visible focus ring for keyboard use, and captions for any pet speech (reuse the F2 subtitles behavior).

### A.9 Room side of the transition
- On `exit()` toward Camera: stop orbit input, snapshot the pet's `PetSession` (position, heading, current clip name) and fade the room scene's opacity to 0 over about 0.5 s (the shell runs the crossfade). The dog stays rendered throughout.
- On `enter()` from Camera: restore the orbit camera at its last pose, place the dog where `PetSession` says, re-enable room input.
- Dispose nothing on exit (the room is cached for instant return).

### A.10 Milestones (Person A)

| Hours | Work |
|---|---|
| 0–2 | Pair with Person B on the shell, `PlayView`/`PetSession`, engine seams (`setView`, `setExternalCamera`, `setOverlayScene`, `setGroundPlane`). Empty floor + dog in the shell. |
| 2–6 | Procedural room (floor, walls, window, rug, bed, bowls, bin, props), lighting, blob shadows. |
| 6–10 | Orbit camera, zoom, pan, focus, inertia, bounds; gesture arbitration with `Interactions`. |
| 10–14 | 3-D floor movement in `Behavior` (walk, steer around obstacles), ground-plane raycasts, drag-the-dog. |
| 14–17 | Depth-tested splats vs. room geometry; furniture spots driven by needs; the eat/sleep/play routines. |
| 17–20 | Room UI, coach marks, states, accessibility, performance pass, crossfade with Part B. |
| 20+ | Device testing, rehearsal, bug fixes only. |

### A.11 Part A acceptance criteria
- [ ] Room opens with the dog visible and breathing within 3 s on a mid-range phone.
- [ ] One-finger drag on empty space orbits; pinch zooms; double-tap focuses the dog; limits keep the camera inside the allowed volume (no seeing outside the world, no clipping through walls).
- [ ] Dragging on the dog moves the dog and never orbits; dragging on empty space never moves the dog.
- [ ] The dog walks on the floor in 3-D, faces its direction of travel, and never walks through furniture or walls.
- [ ] The dog is hidden correctly when behind furniture (depth test) and not when in front of it.
- [ ] Needs steer the dog: hungry → bowl, tired → bed (verified by setting stats via a debug control); user commands always interrupt.
- [ ] Stroke, poke, feed, ball fetch, point and voice intents work in the room with no regression vs. the desk.
- [ ] Reaction latency to local intents stays under 300 ms (re-run `/?accept=1`).
- [ ] 30+ fps in the room at the `low` preset on a mid-range phone with the full room visible.
- [ ] Switching to the camera view and back preserves the dog's state and the orbit pose.

### A.12 Part A risks and mitigations

| Risk | Mitigation |
|---|---|
| Touch gesture conflicts (orbit vs. dog drag vs. window-level `Interactions` listeners) | Decide ownership at `pointerdown` using the hit tests; add `claimGesture(pointerId)`; test with fast and slow drags, multi-touch |
| Depth artifacts where splat quads meet the floor/furniture | Lift pet slightly, fade near-floor splats, contact shadow, document as a known limit |
| Room geometry steals GPU budget from the splats | ~20k triangle cap, no shadow maps, `?room=low`, auto-degrade already exists |
| Behavior refactor from 1-D to 3-D breaks the desk view or `/?accept=1` | Keep both mappings behind `setView`; run the acceptance harness and the desk demo page after every behavior change |
| Ball physics is a 2-D plane (Rapier world locked on z) | Keep the ball on a 2-D plane aligned to the dog's current heading, or unlock z with a floor collider; pick the simpler of the two if time is short |
| Procedural furniture looks flat | Spend time on palette, baseboard, window light, and a few small props; contact shadows do a lot of the work |
| Spot selection feels random or twitchy | Hysteresis, minimum stay time, and a debug overlay showing weights |

---

## PART B: SNAPCHAT-STYLE CAMERA (Person B)

**Goal:** the camera is the environment and the dog is the subject. The rear camera fills the screen and the personalized 3D dog stands directly in the live view, spatially anchored and visibly alive, with minimal controls. The user should think *"I'm looking through my phone camera and my dog is here."*

Lives in `apps/web/src/play/camera/` plus the engine seams listed in B.6.

### B.1 Responsibilities
Camera stream, device orientation pseudo-AR, optional WebXR, tap-to-place and scale, look-at and "alive" layer, ambient integration effects (tint, shadow), interaction in the camera view, capture and share, camera UI, the Camera side of the view transition.

### B.2 Visual contract
```
┌─────────────────────────────┐   REAL WORLD CAMERA fills the whole screen
│  ‹ back                flip │
│                             │
│                             │
│            🐕               │   the dog renders directly over the live video:
│       (AI dog, 3D)          │   no card, panel, modal or "camera rectangle"
│                             │
│                             │
│  🎤        ◯ capture    ⋯  │
└─────────────────────────────┘
```
- The `<video>` element and the engine canvas are stacked full-viewport (`100dvh`, safe-area insets). The engine canvas is transparent (it already is: `alpha: true`, `premultipliedAlpha: true`).
- The dog is the only 3D content in this view (no room geometry).
- The UI never covers the middle of the screen. Controls sit at the edges and are small.

### B.3 Camera stack (`stream.ts`)
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width/height: ideal 1280×720 }, audio: false })`.
- `<video playsinline muted autoplay>`, `object-fit: cover`, starts as soon as the view enters. First frame must be visible within about 1 s of granting permission.
- **Flip camera** button toggles `facingMode` `environment` ↔ `user` (the front camera mirrors; the dog stays unmirrored).
- **Permission and error UX:** denied → friendly one-liner with a "Try again" button and a way back to the Room; no device camera → fall back to the Room with an explanation; stream interrupted (tab backgrounded, another app takes the camera) → re-acquire on visibility return without reloading.
- Stop tracks on `exit()` (release the camera light) and when the page is hidden.
- **Dev mock:** `?video=<url>` swaps in a looping video; `?orient=mouse` simulates device orientation with a mouse drag (so desktop and Playwright can exercise everything).

### B.4 Spatial anchoring: pseudo-AR (`pose.ts`) — the universal tier
Works on iOS and Android with no AR support.

- **Orientation source:** `deviceorientation` / `DeviceOrientationEvent` (with `webkitCompassHeading` where useful). iOS requires `DeviceOrientationEvent.requestPermission()` inside the camera-button tap. Convert to a camera quaternion (account for screen orientation) and apply it to `Engine.cameraRef`. Smooth with a small low-pass filter (slerp factor about 0.2) to hide sensor jitter.
- **Field of view:** vertical fov about 60° (typical phone rear camera in portrait). Expose a calibration constant, because phones differ.
- **Virtual floor:** assume camera height 1.4 m above a horizontal floor plane (`setGroundPlane(0)`), camera at (0, 1.4, 2.0), anchor at the origin. When the phone tilts down the dog appears lower in the frame, as it would for a real floor object.
- **Anchoring behavior:** turning the phone keeps the dog fixed in the world (it slides across the screen opposite to the turn). Walking toward or away from the dog does **not** change its apparent size (no translation tracking) — a documented limit of the universal tier.
- **Yaw drift:** gyro yaw drifts over time. Provide a "recenter" gesture (long-press on empty space, or an action chip) that re-zeroes yaw so the dog is in front of the user again.
- **Tap-to-place:** tapping the floor area raycasts the screen point to the virtual ground plane and places or walks the dog there. Distance is clamped (about 0.8 m to 5 m) so it cannot be placed absurdly far or at the camera.
- **Pinch to scale:** two-finger pinch scales the dog between about 0.25× and 2× of its default AR size (`PetSession.scale`).
- Compensate screen rotation (lock the page to portrait if possible; handle landscape defensively).

### B.5 WebXR tier (`xr.ts`) — Android Chrome only, stretch
- Feature-detect `navigator.xr?.isSessionSupported('immersive-ar')`. If supported, show a small "True AR" toggle. Never required; never shown on iOS.
- Use WebXR hit-test to find the real floor and place the anchor there. Use the XR session's camera pose instead of the gyro quaternion, so walking around the dog works.
- The splat renderer currently derives focal length from the camera `fov` and the drawing-buffer size. In an XR session that must come from the per-view projection matrix (focal in pixels about `projection[0][0] * viewportWidth / 2` and likewise y) and the XR layer's viewport. This is a contained change in `SplatMesh.update` and must keep the non-XR path identical.
- Fall back to the pseudo-AR tier automatically if the session fails or ends.
- **Cut this tier first** if behind schedule (see 0.13 cut order).

### B.6 "Alive" layer and behavior (`lookat.ts` + small `Behavior`/`Engine` seams)
The dog must never freeze waiting for input.

- **Existing life kept:** breathing/idle clips, tail, idle routine, `react`, needs and mood (all from the engine).
- **Look at the user:** after the animation pose is applied, override the head bone's yaw and pitch so the head turns toward the camera, clamped (about ±70° yaw, ±35° pitch), blended with a smoothing factor so it never snaps. Implemented as a post-pose hook on `Engine.tickBehavior` that writes to the skeleton's head bone. Eyes are not modelled in the splat, so there is **no blink** (documented limit); the head and ears and tail carry the life.
- **Glance behavior:** the dog periodically looks at the camera for 1–3 s, then away at a random point (a gaze target on the ground plane), at irregular intervals.
- **Reacting to phone movement:** a fast turn or a sudden jolt (angular speed above a threshold) makes the dog startle or look up (reuse `startle`/`perk`); steady movement keeps it relaxed.
- **Out of frame:** if the dog has been out of the view frustum for about 3 s, it trots back toward the centre of the view and sits or greets (reuse `come`/`wag`).
- **Greeting:** on entering the camera view the dog turns to face the user and does a short greeting clip, then settles into idle.
- **Needs/mood keep working** (it can still yawn, nap, get hungry), but long routines are disabled that make it leave the screen (the exit/return errand animations are out of scope here).

### B.7 Interaction in the camera view
| Input | Result |
|---|---|
| **Tap the dog** | `POKE` → head turns to the camera, tail wag, happy clip (new composite "tap" reaction: look-at + `wag` + happiness bump). Must feel like touching the dog, not pressing a button |
| **Drag the dog** | The dog is carried: it follows the finger along the virtual floor (ground-plane raycast), then walks to the drop point and settles |
| **Tap the floor** | `POINT`: the dog walks there |
| **Pinch** | Scale the dog |
| **Mic (push-to-talk)** | Voice → local intents (`sit`, `stay`, `come`, `speak`, `roll_over`, `spin`, `play_dead`, `shake`, `dance`, `hide`, `sleep`, `wake`, …) via the F2 pipeline → `engine.doIntent` |
| **Action chips** (small, optional) | A couple of quick buttons: treat, ball (spawns the ball on the floor plane), recenter |
| **Capture** | See B.9 |

The existing `Interactions` window listeners keep working; Person B only needs the camera view's `toWorld` mapping to use the virtual ground plane (`setGroundPlane`) and the camera pose.

### B.8 Integration effects (making it feel in the world)
- **Ambient tint (`tint.ts`):** every ~500 ms downsample the video frame to a tiny canvas and compute the average color. Feed it to a new `uTint` uniform in the splat fragment shader (multiplied into `vColor`, strength about 15–25%) so the dog picks up the room's color temperature. Keep it subtle and smoothed (low-pass over time).
- **Contact shadow:** keep the blob shadow under the dog on the virtual ground, sized to the pet scale, with an opacity matched to the scene brightness (darker video → softer shadow).
- **Grain/noise match (optional):** a light film-grain overlay on the engine canvas so the dog does not look cleaner than the camera feed (cut first if slow).
- **Known limits (stated in the UI help and here):** no real occlusion (the dog draws over everything), no lighting from the real scene beyond the tint, and gyro anchoring cannot track walking through the room.

### B.9 Capture (`capture.ts`)
- The capture button draws the current video frame, then the engine canvas, into one offscreen 2D canvas (match the video's aspect) and exports `image/jpeg` (or png). The renderer must be rendered in the same task immediately before `drawImage` (or the engine created with `preserveDrawingBuffer` only during capture), otherwise the canvas reads back blank.
- Output: `navigator.share({ files })` when available (mobile), otherwise a download. A brief shutter flash and a small thumbnail confirm the capture. Captures never include UI chrome.
- Front camera: **decided: the photo is what-you-see.** The front-camera preview is mirrored, so the saved photo is mirrored too. Saving it un-mirrored would put the dog in a different place than it was on screen.
- Video recording is a non-goal (a future `MediaRecorder` addition).

### B.10 Camera UI (`ui.ts`)
Minimal, social-camera style:
- **Top left:** back (to the Room). **Top right:** flip camera. Small and translucent.
- **Bottom centre:** large capture button. **Bottom left:** mic (push-to-talk). **Bottom right:** a single "more" chip that expands the quick actions (treat, ball, recenter).
- Safe-area insets on all edges; the central 70% of the screen is free of UI.
- **First-run coach mark:** "Move your phone — your dog is here" and an arrow to tap the floor to place it.
- States: permission prompt (one line, large primary button), denied/unavailable (explain + return to Room), orientation permission denied (continue without anchoring, with a note that turning the phone will not move the dog), recoverable stream errors.

### B.11 Camera side of the transition
- On `enter()` from Room: request camera and orientation permission inside the camera-button tap (iOS gesture rule), set `setView('camera', { petScale: 0.45 })`, `setExternalCamera(true)` with the gyro pose, `setSplatDepthTest(false)`, place the dog at the AR anchor facing the user, and hold the overlay until the first video frame arrives (the shell crossfades Room → Camera over about 0.5 s).
- On `exit()` back to Room: stop tracks, remove listeners, restore nothing in the engine (the Room re-applies its own `setView`/camera), write the dog's final pose into `PetSession`.
- If the camera cannot start, the shell cancels the transition and keeps the Room (no black screen).

### B.12 Milestones (Person B)

| Hours | Work |
|---|---|
| 0–2 | Pair with Person A on the shell, `PlayView`/`PetSession`, engine seams. Fake video + dog in the shell. |
| 2–6 | Camera stack (`getUserMedia`, flip, errors, `?video=`), full-screen stacked video + canvas, minimal camera UI skeleton. |
| 6–10 | Gyro pseudo-AR: permission flow, orientation → camera quaternion, virtual ground plane, tap-to-place, pinch-to-scale, recenter, `?orient=mouse`. |
| 10–14 | Look-at layer, glances, out-of-frame return, phone-motion reactions, tap/drag reactions; wire the F2 voice pipeline. |
| 14–17 | Capture (composite + share), ambient tint, contact shadow tuning, coach marks and error states. |
| 17–20 | Crossfade with the Room, device performance pass (low preset), accessibility, edge cases (background/resume, rotation). |
| 20+ (stretch) | WebXR tier on Android; film grain; polish. Device testing and rehearsal. |

**Build status (desktop, fake video feed + simulated motion; not yet run on a phone):**

| Section | Status |
|---|---|
| B.2–B.4 camera stack, gyro anchoring, tap-to-place, pinch, recenter | Built, checked on desktop |
| B.5 WebXR tier | Written, never run (needs an Android phone) |
| B.6 alive layer | Built; phone-jolt reaction needs a real motion sensor to check |
| B.7 interactions, voice | Built; voice uses browser speech recognition, real speech not exercised |
| B.8 tint and shadow | Built; film grain not built |
| B.9 capture | Built; composite verified to contain the dog and no UI |
| B.10 camera UI, coach mark, states | Built |
| B.11 transition | Built in the shell (curtain crossfade, failed camera keeps the previous view); checked against a stand-in Room |

### B.13 Part B acceptance criteria
- [ ] Pressing the camera button shows the rear camera full-screen and the dog on top of it within 1.5 s of permission being granted; there is no card, panel or modal around the camera.
- [ ] On iOS Safari and Android Chrome the camera, orientation and microphone permission flows work from a single tap and recover from a denial.
- [ ] Turning the phone slowly keeps the dog anchored in the scene (it slides across the screen opposite the turn) with no visible jitter; recenter fixes drift.
- [ ] The dog sits on a believable floor plane: its feet meet the ground plane and its scale stays natural (about 0.45 m) as the phone tilts.
- [ ] Tap-the-dog gives a look-at + wag reaction in under 300 ms; dragging moves the dog along the floor; tapping the floor walks it there; pinch rescales it.
- [ ] The dog is never frozen: breathing, tail, head glances and idle behavior run continuously; it reacts to a fast phone movement and returns when out of frame.
- [ ] Voice commands trigger the matching local intents; the dog's TTS/SFX never self-triggers the mic.
- [ ] Capture saves or shares a photo of the camera frame plus the dog with no UI in it.
- [ ] Switching Camera → Room → Camera repeatedly releases the camera light and leaks no listeners; the dog keeps its state.
- [ ] 30+ fps in the camera view at the `low` preset on a mid-range phone.
- [ ] If WebXR ships: on a supported Android phone, walking around the dog works, and failing or ending the session falls back to the pseudo-AR path without a reload.

### B.14 Part B risks and mitigations

| Risk | Mitigation |
|---|---|
| iOS has no browser AR (no plane detection, no occlusion, no translation tracking) | Set expectations in the PRD and UI copy; design the universal tier to be convincing with gyro anchoring + shadow + tint; WebXR only as an Android upgrade |
| Gyro yaw drift makes the dog "slide" over time | Low-pass filtering, easy recenter, optional auto-recenter when the user taps to place |
| Permissions (HTTPS, iOS gesture-gated orientation, camera denied) | LAN HTTPS dev server, request in the button tap, explicit error states, a way back to the Room |
| Phone GPU/thermal limits with a 300k splat dog plus a live video | Default `low` preset (120k), render scale 1.0–1.25, existing fps rescue; measure on real hardware early |
| Capture reads a blank canvas (WebGL drawing buffer is cleared after compositing) | Render and `drawImage` in the same task, or toggle `preserveDrawingBuffer` only during capture; add a Playwright test |
| Dog does not look like it belongs in the scene | Ambient tint, contact shadow, optional grain, correct scale; set honest expectations about occlusion |
| Splat shader needs per-view projection in XR | Isolate the change in `SplatMesh.update` with a unit-of-work test that the non-XR path is unchanged; stretch tier so it can be cut |
| Phone screen rotation/orientation edge cases | Prefer portrait lock, handle `orientationchange`, test both |

---

## 0.13 Cut order (if behind)
1. WebXR tier (Person B stretch).
2. Film-grain overlay and ambient tint (keep contact shadow).
3. Room: window light shaft, small props, auto-orbit drift.
4. Room: furniture spots beyond bed and bowl (keep needs-driven sleep and eat).
5. Out-of-frame return and phone-motion reactions (keep tap and look-at).
6. Room: obstacle steering (keep a clear walkable floor with no furniture in the middle).
7. Capture sharing (keep download).

## 0.14 Testing plan
- **Desktop (every commit):** `pnpm dev`, open the shell; Playwright with `?video=` (a looping test clip) and `?orient=mouse`. Assert that the canvas and video render, tap reactions fire (`engine.state`), view switching works repeatedly, and the capture output is non-blank.
- **Engine regression:** re-run `/?accept=1`; it must stay green after any engine change (3-D movement, depth test, camera hook).
- **Performance:** run the 300k check from the acceptance harness and a phone-profile pass with the `low` preset; record fps in both views.
- **On device (required before the demo):** phone over LAN HTTPS (`@vitejs/plugin-basic-ssl`, `vite --host`) on one iPhone and one Android phone. Checklist: Play → Room orbit; camera button → permissions; slow and fast turn anchoring; tap/drag/pinch; voice; capture; back and forth ten times; background and resume; deny each permission and recover.
- **Visual review:** screenshots of Room (several angles, dog behind furniture) and Camera (dim and bright scenes) reviewed together by both owners.

## 0.15 Milestone summary (both people, 24 hours)

| Hours | Person A: Room | Person B: Camera | Together |
|---|---|---|---|
| 0–2 | Engine seams, empty floor + dog | Fake video + dog | **Freeze shell, contracts, seams** |
| 2–6 | Procedural room, lighting | Camera stack, stacked layout, UI skeleton | |
| 6–10 | Orbit camera, gesture arbitration | Gyro anchoring, tap-to-place, pinch | **Hour 8: crossfade works** |
| 10–14 | 3-D floor movement, drag-the-dog | Look-at, alive layer, voice | |
| 14–17 | Depth occlusion, furniture spots | Capture, tint, shadow | **Hour 14: both on a real phone** |
| 17–20 | Room UI, polish, perf | Crossfade polish, perf, edge cases | **Hour 18: feature freeze** |
| 20+ | Device testing, rehearsal | Optional WebXR, device testing | Rehearsal |

## 0.16 Assumptions to confirm
1. Phones are the primary target; desktop is dev-only. iOS Safari and Android Chrome are both supported (the camera view is the universal gyro tier, with WebXR only as an Android bonus).
2. The Desk's Play toggle will navigate to `camera.html?pet=<id>` (a one-line change in `apps/desk`, agreed with the F2 owner).
3. The placeholder dog bundle is the default pet until real photo-to-splat bundles from `/pets` are available.
4. The room is procedural and fixed (no decorating or alternative rooms in this version).
5. No errands or connector calls run inside the Play shell.
6. Final real-world dog scale (about 0.55 m in the room, about 0.45 m in AR), room size (about 4 m × 4 m) and the assumed 1.4 m camera height are starting values to tune on devices.
7. Voice reuses the F2 pipeline; if its mic/STT cannot run in this entry, push-to-talk falls back to the text command bar.
8. Photo capture only; video recording is a later addition.
