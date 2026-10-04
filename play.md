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
**Decided after device testing: in the camera view the dog only moves on a command.** It is still never frozen.

- **Stands in place:** with no command the dog plays the `stand` clip only (breathing, tail). No roaming, no furniture trips, no naps or yawns. `Engine.setAutonomous(false)` on enter, `true` on exit, so the Room keeps its own idle life.
- **Look at the user:** after the animation pose is applied, the head bone's yaw and pitch are overridden so the head turns toward the camera, clamped and smoothed. Eyes are not modelled in the splat, so there is **no blink** (documented limit).
- **Glance behavior:** the dog looks at the camera for 1–3 s, then away at a random point, at irregular intervals. Head only.
- **The view never pans on a laptop:** dragging empty screen does nothing (look-around exists only with `?orient=mouse` for development). Phones keep gyro anchoring.
- **Reacts without moving:** a tap or stroke gives the wag reaction; speaking holds its attention. It does not react to phone jolts and does not walk back when out of frame (both removed: they moved the dog with no command, and broke held poses).
- **Poses hold:** `sit`, `stay`, `play_dead`, `hide` and `sleep` last until the next command. "Stand", "stop", "get up" or the Stand chip end them.
- **Stands at the side:** on enter and on Recenter the dog goes to the outer side of the shot (right by default) and faces the centre, so it does not cover the user on a front camera or webcam. The spot is worked out from the screen shape: on a narrow portrait phone the dog stands farther back (up to 5 m), and only shrinks if it still does not fit. "Swap side" (chip, or say "other side" / "move over") walks it across; the side is remembered for the session. It does not dodge by itself if the user leans into it.
- **Follow:** "follow" (voice or chip) makes the dog walk to stay in front of the user when they turn more than about 14°, at its current distance. Any other command, a floor tap or recenter ends it. "Stay there" ends it and holds the dog where it is.

### B.7 Interaction in the camera view
| Input | Result |
|---|---|
| **Tap the dog** | `POKE` → head turns to the camera, tail wag, happy clip (new composite "tap" reaction: look-at + `wag` + happiness bump). Must feel like touching the dog, not pressing a button |
| **Drag the dog** | The dog is carried: it follows the finger along the virtual floor (ground-plane raycast), then walks to the drop point and settles |
| **Tap the floor** | `POINT`: the dog walks there |
| **Pinch** | Scale the dog |
| **Mic (tap to toggle)** | Tap to start, tap again to stop; it also stops by itself about 1 s after you finish speaking (level-based, relative to the room noise), after 6 s of silence, or at 8 s. While recording the mic button swells with your voice and a "Listening" pill shows. From the end of recording until a command is found a blue spinner and an **"Interpreting..."** pill show and the dog stays in its listening pose, so it never looks like nothing is happening. Two recognizers side by side: the browser's own (fast, but needs Google/Apple's service) and **Whisper on the device** (`whisper.ts`, transformers.js, `whisper-tiny.en`, no key and no server, about 40 MB downloaded once then cached; about 1.5-2 s per phrase on a laptop). A phrase that parses as a command wins immediately, otherwise the Whisper text is used; clips under 0.35 s or near silence are ignored; the clip is normalised before recognition so a quiet microphone is not a different transcript. The model downloads in the background when the camera opens. Matching is tolerant of common mishearings ("sit" → "sieve", "set", "sat"). → local intents (`sit`, `stay`, `come`, `speak`, `roll_over`, `spin`, `play_dead`, `shake`, `dance`, `hide`, `sleep`, `wake`, `stop`/"stand") plus "follow" → `engine.doIntent`. A failure shows the real reason (blocked mic, no speech service, nothing heard), never a generic message. Server-side transcription is the next step if the target browser has no speech service |
| **Menu (⋯)** | Only "My dog photo" and "Recenter" (plus "True AR" where the device supports it). Commands are spoken; there are no command buttons |
| **Capture** | See B.9 |

The existing `Interactions` window listeners keep working; Person B only needs the camera view's `toWorld` mapping to use the virtual ground plane (`setGroundPlane`) and the camera pose.

### B.7a Voice commands (`play/commands.ts`, `camera.ts`)
**Whatever the user says, the dog does something.** The transcript goes to a local matcher (no network, no key): each word is compared with every command's phrases by spelling (edit distance) and by sound (same first letter and consonant skeleton), filler words count for little, and the best command above a low floor wins; ties go to the command whose key word was said first. So "sot dawn" is Sit, "sit" is Sit, and "I want you to roll over on the floor right now" is Roll over. If nothing relates, or no answer arrives within 4 s, the dog wags with hearts; an answer that arrives later (up to 8 s) is still performed. A new command replaces the running one at once.

| Command | Behaviour |
|---|---|
| Sit | sits, faces you, tail wags; holds until the next command |
| Come here | runs to about 1.2 m from you, woof, wags |
| Follow me | goes to the pointer / your finger as it moves (changed in 6d9bf54; it used to keep in front of you as you turn), until another command |
| Lie down | belly down, head on paws (new `lie` clip); holds until the next command |
| Jump | hops, lands, woof, wags |
| Go left / right | walks about 0.9 m across the screen, stops, looks at you |
| Go up / down | moves away from you / toward you (screen directions) |
| Turn around | spins, ends facing you |
| I love you | runs closer, head tilts, hearts, wags |
| Good dog | hearts, jump, fast wag |
| Give me your paw | raises a paw toward you for about 2.5 s |
| Say hi | waves a paw, woof |
| Look at me | turns to face you and holds the look for 3 s |
| Dance | sparkles, dances, spins, woof |
| Play dead | falls over, lies still 3 s, springs up, wags |
| Roll over | rolls, stands |
| Surprise me | sparkles and a random trick (never the same twice in a row) |
| Stand up (unlisted) | "stand up", "get up", "stop": ends a held Sit or Lie down |

Since 6d9bf54 the dog's body is also clamped to the visible frame every frame, so it cannot be left off-screen: turning away slides it along the edge instead of leaving it anchored in the room. Recenter brings it to the middle.

An **info button** ("i", top right under the flip control) opens a panel listing every command, with a note that exact words are not needed; "Got it" closes it. The list is generated from the same table the matcher uses, so it cannot drift from what the dog understands.

The "woof" is a synthesized bark (`play/sfx.ts`, no audio files), a head jerk and a "Woof!" bubble; it plays only after the microphone has closed. Limits: English, word-level matching (no paraphrase understanding such as "make yourself comfy"); directions are screen directions, not real-world surfaces.

### B.8 Integration effects (making it feel in the world)
- **Ambient tint (`tint.ts`):** every ~500 ms downsample the video frame to a tiny canvas and compute the average color. Feed it to a new `uTint` uniform in the splat fragment shader (multiplied into `vColor`, strength about 15–25%) so the dog picks up the room's color temperature. Keep it subtle and smoothed (low-pass over time).
- **Contact shadow:** a dark, body-shaped shadow (sized from the splat's own footprint, turning with the dog) plus a small dark decal under each foot that fades as the foot lifts. Opacity follows scene brightness but never drops below 60%. With no floor detection (decided: virtual floor plane, no calibration, no WebXR work) this is the only grounding cue.
- **Grain/noise match:** a light static film-grain overlay over the feed and the dog (built; never in captures).
- **Known limits (stated in the UI help and here):** no real occlusion (the dog draws over everything), no lighting from the real scene beyond the tint, and gyro anchoring cannot track walking through the room.

### B.8a Art direction: the plush dog (`engine/sdf/`)
The scanned-looking splat dog was blurry up close, uncanny, not cute, and did not blend with the video. The event brief also asks for techniques beyond mesh rendering. **Decided: a soft plush toy look, drawn with signed distance fields (SDFs).**

- **Default dog (before any photo is uploaded):** "Biscuit", `public/bundles/plush/bundle.json`. It is a bundle with `plush` traits and no splat files. The Play shell loads it by default; `?pet=golden` keeps the scanned splat dog, and the Desk is unchanged.
- **How it is drawn (`sdfPet.ts`):** about 25 ellipsoids joined with a smooth union, each attached to a rig bone, raymarched per pixel inside a box around the pet. The existing clips animate it (walk, sit, wag, head look). Shading is wrapped light, a fuzz rim, noise on the normals, ambient occlusion, a soft halo at the silhouette, glossy button eyes and nose, dashed stitching down the back and under the muzzle. The eyes blink. It writes depth, so Room furniture occludes it.
- **Continuous traits (`PlushTraits`):** body length, girth, leg length, head size, snout length, ear shape (floppy to pointy), ear size, tail length and carriage, and eight colours. The body and its rig are generated from these numbers, so any dog is a different set of numbers, not a different model.
- **Photo upload ("My dog photo" under ⋯):** makes a plush pet from a photo on the device, with no server or quota. **Today only the coat colours come from the photo** (k-means on the middle of the image, `fromPhoto.ts`); the shape stays the default. Reading ear type, snout and build from the photo is not built: it needs a vision model or silhouette fitting (open decision).
- **Flourish:** hearts float up when the dog is petted; a soft sparkle when it appears.
- **Splat route kept:** the server's reference step has an opt-in plush prompt (`style: 'plush'`, selected with `?style=plush` on the page) that turns the photo into a plush toy before TRELLIS. The default prompt is unchanged. **Not exercised yet:** it needs generation quota (a Hugging Face token).

Status: built and checked on desktop only (camera harness passes with the plush dog). The test browser is capped near 30 fps even with an empty scene, so the plush dog's cost on a phone is **unmeasured**; the agreed gate is 30 fps on an iPhone or it is cut back to the splat dog there.

### B.9 Capture (`capture.ts`)
- The capture button draws the current video frame, then the engine canvas, into one offscreen 2D canvas (match the video's aspect) and exports `image/jpeg` (or png). The renderer must be rendered in the same task immediately before `drawImage` (or the engine created with `preserveDrawingBuffer` only during capture), otherwise the canvas reads back blank.
- Output: `navigator.share({ files })` when available (mobile), otherwise a download. A brief shutter flash and a small thumbnail confirm the capture. Captures never include UI chrome.
- Default camera: rear on phones; a laptop only has a front camera, which is detected from the opened track and mirrored like a selfie. The laptop webcam is a development view (the floor is not in shot), the phone is the real experience.
- Front camera: **decided: the photo is what-you-see.** The front-camera preview is mirrored, so the saved photo is mirrored too. Saving it un-mirrored would put the dog in a different place than it was on screen.
- Video recording is a non-goal (a future `MediaRecorder` addition).

### B.10 Camera UI (`ui.ts`)
Minimal, social-camera style:
- **Top left:** back (to the Room). **Top right:** flip camera. Small and translucent.
- **Bottom centre:** large capture button. **Bottom left:** mic (hold to talk). **Bottom right:** a single "more" chip that expands the command and quick-action chips (see B.7).
- Safe-area insets on all edges; the central 70% of the screen is free of UI.
- **First-run coach mark:** "Move your phone — your dog is here" and an arrow to tap the floor to place it.
- States: permission prompt (one line, large primary button), denied/unavailable (explain + return to Room), orientation permission denied (continue without anchoring, with a note that turning the phone will not move the dog), recoverable stream errors.

### B.11 Camera side of the transition
- On `enter()` from Room: request camera and orientation permission inside the camera-button tap (iOS gesture rule), set `setView('camera', { petScale: 0.9 })`, `setExternalCamera(true)` with the gyro pose, `setSplatDepthTest(false)`, place the dog at the AR anchor facing the user, and hold the overlay until the first video frame arrives (the shell crossfades Room → Camera over about 0.5 s).
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

**Build status (desktop only; not yet run on a phone):**

| Section | Status |
|---|---|
| B.2–B.4 camera stack, gyro anchoring, tap-to-place, pinch, recenter | Built, passes the desktop harness |
| B.5 WebXR tier | Written, never run. Out of scope for now (target devices are iPhone and laptop) |
| B.6 alive layer, command-only movement, held poses, follow / stay | Built, passes the desktop harness |
| B.7 interactions, voice, command chips | Built; **real speech recognition has not worked for the user yet** (cause unknown, the toast now reports it) |
| B.8 tint, body shadow, paw contact decals, grain | Built |
| B.9 capture | Built; composite verified to contain the dog and no UI |
| B.10 camera UI, coach mark, states | Built |
| B.11 transition | Built in the shell (failed camera keeps the previous view) |

### B.13 Part B acceptance criteria
Measured by `/camera.html?pet=dog&accept=camera` (`src/play/camera/acceptance.ts`): a fake canvas camera, synthetic device-orientation events, the placeholder dog, on a desktop with an Intel Arc GPU. `[x]` = passes there. `[ ]` = cannot be shown on a desktop; needs a phone.

- [x] Pressing the camera button shows the camera full-screen and the dog on top of it within 1.5 s; no card, panel or modal. *450 ms from tap to live.*
- [ ] On iOS Safari and Android Chrome the camera, orientation and microphone permission flows work from a single tap and recover from a denial. *Simulated denial keeps the Room and retry works; real prompts not exercised.*
- [x] Turning the phone slowly keeps the dog anchored with no visible jitter; recenter fixes drift. *0.01 m world movement over a 15° turn, jitter sd 0.0012 ndc, recenter to 0.00. Synthetic sensor.*
- [x] The dog sits on the floor plane and its scale stays natural as the phone tilts. *0.000 m height error over stand/sit/lie at 4 tilts, scale 0.9 m throughout (was 0.45 m; doubled after testing).*
- [x] Tap-the-dog gives a look-at + wag in under 300 ms; drag moves it along the floor; a floor tap walks it there; pinch rescales it. *35 ms; drag 0.00 m; floor tap 0.06 m; pinch 0.9 → 1.8.*
- [x] The dog is never frozen, moves only on a command, and a pose holds until the next command (**changed** from "reacts to a fast phone movement and returns when out of frame"). *60/60 distinct poses in 6 s; 0.000 m moved after a jolt and 4.5 s out of frame; sit held 6 s; "follow me" + 60° turn brings it back in front; "stay there" keeps it put.*
- [ ] Voice commands trigger the matching local intents. *15/15 phrases map correctly and "please sit" plays the sit clip, but through the parser only. With a real microphone the user got an error; unresolved until the phone test.*
- [x] Capture produces the camera frame plus the dog with no UI in it. *0 px differ under the controls. Share sheet / download not exercised.*
- [x] Switching Camera ↔ Room five times releases the camera and leaks nothing; the dog keeps its state. *0 live tracks in the Room, 0 leaked layers or handlers.*
- [x] The dog stands at the side of the shot, fully in frame, facing the centre; "other side" swaps it. *Screen x 0.52 on the right facing left, -0.52 after the swap facing right (landscape). Portrait (430x900) checked by screenshot: the dog stands 4.5 m back and fits the right half.*
- [ ] 30+ fps in the camera view at the `low` preset on a mid-range phone. **At risk:** with the real golden-retriever bundle (120k splats drawn at `low`) the desktop harness measures about 30 fps, down from 60 fps with the 10.8k placeholder, and the render scale had already dropped to 1.0. Not measured on a phone.
- [ ] WebXR: not run, and out of scope for the current target devices.

**Success test agreed with the owner (must be shown on a phone):** I say "sit" and the dog sits and stays sat; it stands on the floor and does not move unless I tell it to; I take a photo and the dog looks natural in it.

### B.14 Part B risks and mitigations

| Risk | Mitigation | Status |
|---|---|---|
| iOS has no browser AR (no plane detection, no occlusion, no translation tracking) | Gyro anchoring + shadow + tint; honest limits in the coach mark | Built. Occlusion is a stated limit, not planned |
| Gyro yaw drift makes the dog "slide" over time | Low-pass filtering, easy recenter | Built. Auto-recenter on tap-to-place not built |
| Permissions (HTTPS, iOS gesture-gated orientation, camera denied) | `pnpm dev:phone` (LAN HTTPS), prompts requested inside the tap, explicit error states, a way back to the Room | Built; untested on a real phone |
| Speech recognition is missing or fails in the target browser | Whisper runs on the device so it does not depend on Google/Apple's service; the toast reports the real error; command chips as a fallback | Built. **Verified on desktop with a spoken-phrase test** (Windows text-to-speech "sit" → recorded through a real `MediaRecorder` → Whisper → the dog sits 1.8 s after release). **Not verified: a real microphone, or an iPhone** (first model download needs internet once; speed on a phone unknown). Server-side transcription (ElevenLabs Scribe etc.) stays the upgrade if Whisper is too slow on the phone |
| Phone GPU/thermal limits with a live video | Default `low` preset (120k), render scale 1.0–1.25, existing fps rescue | Built; not measured on a phone |
| Capture reads a blank canvas | Render and `drawImage` in the same task; harness check | Built and checked |
| Dog does not look like it belongs in the scene | Tint, body-shaped shadow, paw contact decals, grain, 0.9 m scale | Built. The floor is an assumed plane 1.4 m below the phone, so on a webcam that does not see the floor the dog still stands in mid-air |
| Splat shader needs per-view projection in XR | Isolated in `SplatMesh.update`; non-XR focal length checked unchanged | Built; XR itself never run |
| The dog covers the user on a front camera | Side placement worked out from the screen shape, swap-side control, drag and tap-to-place | Built. No face/body detection: it will not dodge if the user leans into it. Phase 2 if needed: MediaPipe selfie segmentation (vendored, front camera only) to pick the free area and step aside, auto-disabled below 25 fps |
| Phone screen rotation | Portrait lock attempted (browsers usually refuse outside fullscreen); the pose reads the live screen angle | Built; landscape untested on a phone |

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
