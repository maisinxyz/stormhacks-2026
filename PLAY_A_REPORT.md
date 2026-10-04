# Fetch Play — Part A implementation report

## Read and understood

`play.md` was read end to end. The implementation follows the shared Play model: one persistent `PetSession`, a shell-owned `Engine`, Room as the default view, Camera as the next view, and no Work-mode connector path inside Play.

## Implemented prerequisites

- `apps/web/camera.html` is the Play entry point.
- `apps/web/src/play/types.ts` defines `PlayView`, `PlayContext`, `PetSession`, `PlayViewId`, and `ShellEvent`.
- `apps/web/src/play/session.ts` loads a bundle and falls back to the placeholder dog.
- `apps/web/src/play/shell.ts` / `session-shell.ts` own the single engine, session, view transitions, frame loop, and cleanup.
- `apps/web/src/play/ui.css` provides phone-first safe-area controls and the shell overlay styles.
- `apps/web/vite.config.ts` builds both `index.html` and `camera.html`.
- The Desk Play button now navigates to `/camera.html?pet=<id>`.
- A shared Camera placeholder exists so Room → Camera → Room can be exercised before Part B lands.

## Part A.1–A.12

- A.1: Room ownership is isolated under `apps/web/src/play/room/` with the shared shell seam.
- A.2: `apps/web/src/play/scene.ts` creates the procedural low-poly room: floor texture, walls/baseboard, window/light shaft, rug, dog bed, bowls, toy bin/ball, plant, table, lighting, and low-detail fallback.
- A.3: `apps/web/src/play/orbit.ts` adds room orbit, pitch/distance limits, wheel zoom, double-tap focus, gesture arbitration, pointer capture, and cleanup.
- A.4: `Behavior` now carries floor `z`, walks toward `(x,z)` points, turns toward travel, and preserves the old desk 1-D calls. `Engine` now maps room/camera pointer rays to the ground plane.
- A.5: Room overlay geometry renders before the splat, splat depth testing is controllable, and the contact shadow uses depth testing plus polygon offset.
- A.6: Needs-driven bed, bowl, rug, window, and toy-bin spots are defined in `room/spots.ts`; selection has scored weights and 6–15 second hysteresis.
- A.7: Room gesture arbitration reserves empty-space gestures for orbit, while dog gestures remain with the engine; pet drags now move on the floor and settle at the drop point.
- A.8: Room UI includes safe-area controls, loading/fallback notices, coach mark, captions-ready status, back/camera controls, mic, ball, and treat actions.
- A.9: Room exits snapshot position/heading, clears view-owned geometry/input, and the shell crossfades between views without reloading the pet.
- A.10–A.12: Milestone/acceptance seams are documented here; `?accept=1` runs the Play shell smoke harness, while the existing `/?accept=1` engine regression remains available.

## Engine seams added

`apps/web/src/engine/index.ts` now exposes the Play seams:

- `setView('desk' | 'room' | 'camera', { petScale })`
- `setExternalCamera`
- `cameraRef`
- `setOverlayScene`
- `setGroundPlane`
- `setSplatDepthTest`
- `claimGesture` / `releaseGesture`
- `getPetState` / `applyPetState`

Room geometry is added before the splat and the splat depth-test can be enabled for the Room. The Desk path remains on the existing z=0 mapping.

## How to check

```bash
cd apps/desk
npm run build
npm run dev
```

In the Desk, press Play. The browser navigates to the Play entry.

For the Play app itself:

```bash
cd apps/web
npm run typecheck
npm run build
npm run dev -- --host
```

Open `/camera.html?pet=dog` or `/camera.html?room=low&pet=dog`.

Desktop checks:

- Drag empty space to orbit.
- Scroll to zoom.
- Double-click/tap the dog to focus.
- Dragging the dog is reserved for the engine interaction path.
- Press the Ball/Treat controls.
- Use Back to return to the Desk placeholder path; Camera currently displays the shared transition placeholder for Part B.

## Integration handoff

### F1

The real `Engine` is already the shared runtime. Keep `PetSession` state when adding Part B. F1 should complete the remaining engine behavior pieces against these seams, especially true 3-D drag/drop and interaction mapping.

### Person B / Camera

Replace `CameraPlaceholder` in `apps/web/src/play/session-shell.ts` with the Part B `CameraView`. It receives the same `PlayContext`, so it can use `engine`, `session`, `canvas`, `switchTo('room')`, and `exit()` without changing Room code.

### F2 / Desk

The navigation handoff is implemented in `apps/desk/src/App.tsx`. The current query value is the active pet id; session loading currently maps the placeholder/demo id to the dog bundle. Replace `loadPetSession()` with the B2 `/pets/:id` fetch once the API is available.

### B2 / pets and media

`apps/web/src/play/session.ts` should load a real `PetBundle` from `/pets/:id` or a signed bundle URL. The fallback remains required for a missing/bad id.

## Verification

- `apps/desk`: `npm run build` passed.
- `apps/web`: `npm run typecheck` passed.
- `apps/web`: `npm run build` passed and emits both `dist/index.html` and `dist/camera.html`.
- Part B camera implementation, device HTTPS testing, and final hardware performance validation remain outside Part A and still require their respective workstreams.
