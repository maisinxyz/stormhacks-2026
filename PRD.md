# Fetch — Product Requirements Document v3 (4-Person Split)

**One-liner:** A web-based interactive pet (dog, cat, rodent, bird), generated from a photo or drawing and rendered as a 3D Gaussian splat, that you command by voice and play with on-device. In Work mode it runs real agentic errands (email, docs, calendar) as visible, species-specific animations; in Play mode it is pure fun with no connectors.

**Changes from v2:** work now split across 4 people: **F1** Gaussian splatting and pet engine, **F2** app frontend UI/UX, **B1** agent and connectors, **B2** media, data and infra. Earlier changes still apply: webcam gestures removed (voice + mouse/touch/keyboard only); web app only (no Electron/Tauri overlay); photo/drawing-to-splat generation owned by F1.

---

## PART 0 — SHARED (everyone reads this)

### 0.1 Team & ownership

| Section | Owner | Owns |
|---|---|---|
| **F1 — Gaussian Splatting & Pet Engine** | Frontend dev 1 | Splat renderer, photo/drawing-to-3D generation pipeline (client side), rigging and skinning, species packs, verb animations, behavior state machine, needs, physics toys, edge-peek scene, pointer interactions on the pet |
| **F2 — App Frontend (UI/UX)** | Frontend dev 2 | Visual design system, app layout and the Desk world, onboarding and pet-creation UI, voice pipeline, mode manager UI, approvals and run-log UI, settings, API client, state store |
| **B1 — Agent & Connectors** | Backend dev 1 | Auth and Google OAuth, session and mode, agent loop (LLM + tools), connectors (Gmail/Calendar/Drive), verb tagging, approvals, SSE run streaming, notifications |
| **B2 — Media, Data & Infra** | Backend dev 2 | Server scaffold, database, object storage, deploy, uploads, image-to-3D generation service, prop generation, ElevenLabs proxy, pets persistence, signed URLs |

**Endpoint ownership:** B1 = `/session`, `/auth/*`, `/connectors/*`, `/mode`, `/agent/*`, `/notifications/*`. B2 = `/uploads`, `/gen/*`, `/pets*`, `/voice/*`.

Rules: each owner only edits their own directories. Cross-section changes go through the contracts in 0.5 and 0.6. Shared server pieces: B2 owns the scaffold, DB, and middleware (CORS, logging, rate limiting); B1 owns the `requireUser()` auth middleware. Until B1 ships it (hour 4), B2's scaffold provides a dev stub returning a fixed demo user.

### 0.2 Goals
- Photo or drawing becomes a moving 3D splat pet in about 1-2 minutes.
- 4 species with species-specific idle, locomotion, reactions, voices, and task animations. MVP polish: **dog + bird**. Stretch: cat, rodent.
- Unbounded task set: any task is decomposed into verbs plus props, so animation never needs per-task authoring.
- Work mode (connectors live) and Play mode (connectors disabled), switchable by voice or UI.
- Voice-first control with ElevenLabs TTS/SFX, plus mouse/touch/keyboard interaction on the pet.
- Irreversible actions always require explicit human approval.

### 0.3 Non-goals (MVP)
- Webcam/hand gestures. Desktop overlay, walking on OS windows, or reading OS window geometry. Mobile apps. Multi-user. Real fur/feather simulation. Offline mode.

### 0.4 Platform assumptions
- **Target:** desktop Chrome (latest), WebGL2 required, WebGPU optional. Mic requires a secure context (HTTPS or localhost).
- **Web-only substitution for "desktop life":** the pet lives on a full-page transparent canvas overlaid on the app. F2's **Desk** (an in-app workspace of draggable cards/windows: Inbox, Files, Calendar, Run Log) supplies the "platforms" the pet walks on, perches on, and sits on. This replaces OS window geometry.
- Canvas is `pointer-events: none` except where F1's hit test reports the pointer is over the pet, so the page stays usable underneath.
- Browsers block audio until a user gesture. F2 must unlock the AudioContext on first click ("Wake up your pet" button).

### 0.5 Shared contracts (package `@fetch/contracts`, owned by F2, frozen at hour 2)

```ts
type Species = 'dog' | 'cat' | 'rodent' | 'bird';
type Mode = 'work' | 'play';
type Verb = 'SEARCH'|'FETCH'|'READ'|'WRITE'|'COMPARE'|'ORGANIZE'|'SEND'|'WAIT'
          |'MONITOR'|'CALCULATE'|'NEGOTIATE'|'SUCCEED'|'FAIL';
type Mood = 'neutral'|'eager'|'focused'|'proud'|'sheepish'|'exhausted'|'worried'|'smug'|'sleepy';

interface PetBundle {            // produced by F1, stored by B2, loaded by F1
  id: string; name: string; species: Species;
  splatUrl: string;              // compressed splat (.spz or .splat), rest pose
  rigUrl: string;                // rig.json (bones, bind pose, species template id)
  weightsUrl: string;            // weights.bin: per splat 4x uint8 bone idx + 4x uint8 weight
  thumbnailUrl: string;
  voiceId?: string;              // ElevenLabs voice id (set by B2 via /voice/design)
  personality: { eager:number; sassy:number; anxious:number; chatty:number }; // 0..1
  stats: { energy:number; happiness:number; hunger:number };                  // 0..100
  createdAt: string;
}

interface ActionStep {           // one animated step of an errand
  id: string; verb: Verb; mood: Mood;
  prop?: { kind: 'preset'|'generated'; name: string; imageUrl?: string };
  label: string;                 // human text for the log, e.g. "Searching Gmail"
  toolCallId?: string;
}

// Server -> client run events (SSE), see Part B1 for transport
type RunEvent =
 | { type:'run.started'; runId:string }
 | { type:'run.plan'; steps: ActionStep[] }                       // sent before any tool runs
 | { type:'run.say'; text:string }                                // <= 15 words, for TTS
 | { type:'tool.start'; stepId:string; tool:string; label:string }
 | { type:'tool.progress'; stepId:string; note:string; itemsRead?:number }
 | { type:'tool.retry'; stepId:string; attempt:number }
 | { type:'tool.end'; stepId:string; ok:boolean }
 | { type:'approval.required'; actionId:string; kind:'send_email'|'delete'|'share'|'calendar_invite'|'other';
     preview:{ to?:string[]; subject?:string; body?:string; summary:string }; contentHash:string }
 | { type:'run.result'; summary:string; card?:ResultCard; prop?:ActionStep['prop']; mood:Mood }
 | { type:'run.error'; code:string; message:string; mood:'sheepish'|'exhausted' }
 | { type:'run.cancelled' };

// Client-side event bus (F1 <-> F2), typed, in-process
type BusEvent =
 // F1 -> F2 (pointer interactions detected on the pet)
 | { type:'PET_STROKE'; intensity:number }   // 0..1, continuous stroking over the pet
 | { type:'POKE' }
 | { type:'FEED'; item:'treat'|'fish'|'seed'|'cracker' }
 | { type:'THROW'; vx:number; vy:number }
 | { type:'PET_AT_PLATFORM'; platformId:string }
 | { type:'ENGINE_READY' } | { type:'RETURNED'; runId:string } | { type:'ANIM_DONE'; id:string }
 // F2 -> F1
 | { type:'COMMAND_LOCAL'; intent:LocalIntent }     // sit, stay, trick, etc.
 | { type:'MODE'; mode:Mode }
 | { type:'APPROVE'; actionId:string } | { type:'CANCEL'; runId?:string }
 | { type:'POINT'; x:number; y:number }             // click-to-target in world coords
 | { type:'COMMAND'; text:string; source:'voice'|'text' }; // forwarded to B1 when not local
```

### 0.6 F1 ⇄ F2 engine interface (F2 codes against a mock until F1 ships)

```ts
interface PetEngine {
  mount(canvas: HTMLCanvasElement, peekCanvas: HTMLCanvasElement): void;
  loadPet(bundle: PetBundle): Promise<void>;
  setMode(mode: Mode): void;
  setPlatforms(p: { id:string; x:number; y:number; w:number; h:number; kind:'window'|'card'|'edge' }[]): void;
  runPlan(steps: ActionStep[]): void;            // starts exit anim immediately on run.plan
  pushToolEvent(e: RunEvent): void;              // drives edge-peek + step animations
  showResult(prop: ActionStep['prop'], mood: Mood): void;  // return animation w/ prop
  setApprovalPending(pending: boolean): void;    // pet holds envelope, enables pet-to-approve ring
  doIntent(i: LocalIntent): void;
  setSpeaking(amplitude: number): void;          // call each frame while TTS plays (0..1)
  generatePet(input: { kind:'photo'|'drawing'; image: Blob; species: Species; name: string },
              onProgress:(p:{stage:string; pct:number})=>void): Promise<PetBundle>; // pipeline in 1.2
  on<T extends BusEvent['type']>(t:T, cb:(e:Extract<BusEvent,{type:T}>)=>void): void;
}
type LocalIntent = 'sit'|'stay'|'come'|'speak'|'roll_over'|'spin'|'play_dead'|'shake'
  |'fetch_ball'|'sleep'|'wake'|'trick'|'dance'|'hide'|'stop';
```

### 0.7 Parallel-development mocks (required deliverables)
- **F1:** ships 2 pre-generated bundles (dog, bird) in `/public/bundles/` by hour 5 so F2, B1, and B2 never wait on generation. If B2's raw outputs aren't ready, F1 makes the first two manually from any hosted image-to-3D demo.
- **F2:** contracts package by hour 2; mock engine stub by hour 3.
- **B1:** `MOCK_AGENT=1` (replays a canned SSE run) and `MOCK_CONNECTORS=1` (canned Gmail/Drive/Calendar data); mock SSE run by hour 4.
- **B2:** `MOCK_GEN=1` (returns pre-generated bundle assets) and `MOCK_VOICE=1` (static audio clip); raw splat outputs from the real image-to-3D service for a test dog and bird photo by hour 4, so F1 can build cleanup and rigging on real data.
- All `MOCK_*` flags are also the **demo fallbacks**.

### 0.8 Repo layout
```
/apps/web            (F1 + F2; /src/engine = F1, /src/app = F2)
/apps/server         (B1: src/agent, src/connectors | B2: src/media, src/db, infra)
/packages/contracts  (F2, frozen hour 2)
/public/bundles      (F1, pre-generated pets)
```

### 0.9 Integration checkpoints
- **Hour 2:** contracts frozen. **Hour 8:** F2 renders real engine with a pre-generated dog; B1 serves mock SSE. **Hour 16:** real agent events drive real animations end to end. **Hour 22:** feature freeze; rehearsal only.

### 0.10 Cross-cutting acceptance criteria
- [ ] Full demo flow (0.11) runs with real services; and runs with all `MOCK_*` flags on.
- [ ] No API key ever reaches the client bundle.
- [ ] Nothing outbound or destructive executes without a matching approval.
- [ ] In Play mode no connector can be called (enforced server-side).
- [ ] First animation reaction to a command starts within 300ms; `run.plan` arrives within 2s; first TTS audio within 1s of `run.say`.
- [ ] Sustained 30+ fps with the pet on screen on a mid-range laptop.

### 0.11 Demo script (2 min)
1. Draw a bird on the in-app pad (or upload a drawing photo); it generates and appears as a splat parrot that perches on a Desk window title bar and speaks hello in its own voice.
2. Say "find my budget sheet." The bird flies off; the edge-peek shows it circling with a growing paper pile; it returns with the doc in its talons.
3. Say "email the standup notes to my team." It returns with an envelope and the approval card; say "send it" (or hold-pet to approve). Show the sent email.
4. Swap to a cat from a photo. Same command: stalk, hunt, drop at your feet; different voice and attitude.
5. Say "play time." Connectors grey out; the cat chases the mouse-controlled laser dot.

---

## PART F1 — GAUSSIAN SPLATTING & PET ENGINE (Frontend Dev 1)

Everything inside the canvas, built splat-first: renderer and generation come before species polish. Lives in `/apps/web/src/engine`. F1 is the critical path.

### 1.1 Responsibilities
Render splat pets; generate pets from photo/drawing; rig and skin; implement species packs, verb animations, props, behavior state machine, needs, physics toys, edge-peek scene, and pointer interactions on the pet. Expose the `PetEngine` interface (0.6).

### 1.2 Pet generation pipeline (`generatePet`)
Runs in the app; heavy model inference is called through B2's proxy endpoints (browsers can't run image-to-3D). F1 owns orchestration and everything client-side.

| Stage | Detail | Where |
|---|---|---|
| 1. Input | Photo of a pet, or a drawing (in-app pad export or photo of paper) | client |
| 2. Segmentation | Isolate subject on transparent background; lightweight in-browser SAM-class model (ONNX/WebGPU), fallback to B2 `/gen/segment` | client (fallback B2) |
| 3. Drawing cleanup | If drawing: B2 `/gen/reference` returns a clean reference render of the doodle as the species; then continue as photo | B2 |
| 4. Image to 3D | B2 `/gen/image-to-3d` returns Gaussian splat output (e.g. TRELLIS-class hosted model); poll job status | B2 |
| 5. Splat cleanup | Opacity threshold crop, floater removal (statistical outlier), center and orient (face +Z, feet on y=0), normalize scale, decimate to budget: **<= 300k splats** main, **<= 80k** peek LOD | client |
| 6. Rig fit | Choose species template skeleton; fit by PCA of splat cloud (scale and orient template to body axis), place leg/head/tail/wing bones by template ratios; adjust by splat density landmarks | client |
| 7. Skin weights | Per splat: nearest 4 bones by distance to bone segments, inverse-distance weights, smoothed over a k-NN graph of splats; write `weights.bin` | client |
| 8. Bundle | `splat`, `rig.json`, `weights.bin`, thumbnail; upload via B2 `POST /pets`; B2 returns `PetBundle` | client to B2 |
| Fallback | If steps 4-7 fail or quality score low (floater ratio / thin shape): build a **2.5D layered-sprite rig** from the segmented image (head, body, legs, tail, wings as layers) using the same bone template so every clip still works | client |

Optional **3-photo mode**: front/side/back images sent to B2 `/gen/image-to-3d` for better back-side quality.
Optional **sketchy shader**: toggle that adds boiling-edge wobble and paper grain.

### 1.3 Rendering and skinning
- three.js plus a splat renderer (e.g. Spark). **Verify the chosen renderer supports per-splat custom position/covariance transforms in shader; if not, implement a minimal custom splat renderer.**
- Linear blend skinning in the vertex stage: each splat center is skinned by up to 4 bones; **rotate covariance with the blended rotation** (no shear); resort per frame by depth.
- Transparent background, soft contact shadow (blob decal) on platforms, ambient + one key light feel via color tint of splats (no relighting needed).
- Quality settings from F2: `high` (300k) / `low` (120k); auto-drop if fps < 24 for 3s.
- **Hit test:** a cheap proxy (capsule set per bone) so F2's page stays clickable; report pointer-over-pet to toggle `pointer-events`.

### 1.4 Species packs (data-driven, one folder each)
A pack = `{ skeletonTemplate, clips[12-15], idleList, carry, enter/exit style, props sockets, reactions, foods, games, voicePrompt, personalityDefaults }`. Adding a species means adding one pack.

| | Dog | Cat | Rodent (hamster) | Bird (parrot) |
|---|---|---|---|---|
| Skeleton template | Quadruped | Quadruped, flexible spine | Small quadruped | Biped + wings |
| Locomotion | Walk, run, bound | Walk, stalk, pounce, leap | Scurry, burrow, wheel-run | Hop, flap-hop, fly (fake long flights via off-screen exit) |
| Idle behaviors | Sit, scratch, sniff, flop on a Desk window, roll | Loaf on active window, groom, knock a small UI item off an edge | Run on wheel in a corner, stuff cheeks, stand and sniff | Perch on window title bar/branch prop, preen, head-tilt |
| Reaction to petting | Tail wag, lean in | Slow blink, purr; occasionally walks away | Freeze, then nuzzle | Fluff up, bob |
| Reaction to poke | Startle then play bow | Swat | Squeak, hop back | Squawk, flap |
| Carry socket | Mouth | Mouth | Cheek pouch | Talons |
| Exit/enter style | Runs off edge, dust trail | Leaps out | Tunnels (dirt puff) | Flies off, wing flaps |
| Foods | Treat (bone) | Fish | Seed | Seed, cracker |
| Play games | Ball fetch, tug, hide-and-seek | Laser dot (mouse cursor), box, string | Maze builder, wheel | Mimic game, land-on-cursor, perch hop |
| Voice-triggered tricks | Spin, roll over, play dead, shake | Knock cup off, loaf, flop | Stand up, wheel spin, hide | Wolf whistle, dance bob, mimic last word (visual only; audio via F2) |
| Default personality | Eager, loyal | Sassy, competent | Anxious, thorough | Chatty, gossipy |

### 1.5 Verb animation grammar
Every `ActionStep.verb` is implemented once per species as a composed animation (base clips + prop socket + particle). Unknown tasks never need new clips; B1 maps them to the nearest verb plus a generated prop.

| Verb | Dog | Cat | Rodent | Bird |
|---|---|---|---|---|
| SEARCH | Nose-down sniffing, zig-zag | Stalks, ears swivel | Tunnels, pops up | Circles, scans |
| FETCH | Digs, returns with item | Hunts, drops it at your feet | Stuffs into cheek pouch | Swoops, carries in talons |
| READ | Paw on doc, head moves | Sits on the doc | Skims fast, whiskers twitch | Perches, head-tilts page by page |
| WRITE | Paws a tiny keyboard | Walks across keys | Scribbles with tiny pencil | Pecks keys |
| COMPARE | Head tilts between two props | Bats between two | Sniffs one then other | Hops between two perches |
| ORGANIZE | Sorts props into piles | Bats items into place | Builds nest from files | Arranges items on branch |
| SEND | Runs off with envelope | Pushes envelope off edge | Shoves it down a tube | Flies off with it |
| WAIT | Naps, one ear up | Loafs, tail flick | Wheel run | Preens |
| MONITOR | Sits at edge, ears up | Stares from ledge, tail-tip twitch | Periscope stand | Perched, head swivel |
| CALCULATE | Paw-taps count | Paw on abacus prop | Wheel with number ticker | Beak-tap counting |
| NEGOTIATE | Begs, shakes paw | Stare-down, slow blink | Wrings paws, bows | Squawk call-and-response |
| SUCCEED | Tail-wag burst, jump | Smug slow blink | Cheeks puff, spin | Crest flare, whistle pose |
| FAIL | Ears droop, lies down | Acts unbothered, knocks item off | Freezes, hides in nest | Feathers droop, silent hop |

**Props:** preset sprites (envelope, document, folder, magnifier, keyboard, pencil, calendar, phone, coin, box) plus generated stickers (URL from `step.prop.imageUrl`, transparent PNG). Props attach to species carry sockets or sit as world billboards. Mood modifies pace, posture, and ear/tail/crest pose.

### 1.6 Behavior state machine
States: `idle -> listening -> errand(exit -> working -> return) -> sleep`, plus `play`. Transitions come from bus events, mode, run events, and timers.
- `listening` triggers when F2 signals mic-open (ear perk / head tilt).
- On `run.plan`, **start the exit animation immediately**; do not wait for tool results.
- During `working`, pet is off-canvas; the peek scene is active.
- On `run.result`, play return with the prop and mood. On `run.error`, return with `sheepish`/`exhausted`.
- On `approval.required`, pet returns holding the envelope and stays (`setApprovalPending(true)`).
- Idle chooses from the species idle list; Work-mode idle favors perching/watching near the Desk; Play-mode idle roams.
- Notifications (F2 forwards `PET_AT_PLATFORM`/notice events): new email makes the cat stare, the dog perk, etc.

### 1.7 Needs and mood
`energy`, `happiness`, `hunger` (0-100). Petting/play raise happiness; feeding resets hunger; activity drains energy; sleeping restores it. Needs affect **animation speed, posture, and mood only. They never delay or block real task execution.** Low energy shows sleepy mood and yawns; zero energy auto-naps only when idle. F1 emits stat changes; F2 persists them via B2 (`PATCH /pets/:id`).

### 1.8 Pointer interactions (mouse/touch)
| Input | Result |
|---|---|
| Stroke over pet (drag back and forth) | `PET_STROKE`, reaction per species |
| Click pet | `POKE` |
| Drag treat from F2's tray onto pet | `FEED` (item by species) |
| Click-drag-flick on ball/toy | `THROW` (Rapier physics), pet chases and returns it |
| Click empty area | `POINT`: pet walks/runs there; cat/dog sniffs or sits at target |
| Mouse cursor (Play mode, cat/bird) | Laser dot / landing target |
| **Pet-to-approve** | While approval is pending, a continuous 1.2s stroke over the pet fills a ring and sends `APPROVE`. Leaving the pet resets it. Strokes before the card is visible do nothing. |

Physics toys: ball (dog), string/box (cat), wheel (rodent), perch (bird); Rapier world with platforms from `setPlatforms`.

### 1.9 Edge-peek scene (the signature feature)
A second small canvas docked to a screen edge showing the pet working while off the main canvas. Per-species scenes: dog tail wagging out of a bush, cat tail flicking from behind a ledge, rodent dirt pile growing at a burrow, bird in a nest with wing flaps. Low LOD (80k splats). F2 hosts the dock container and the expandable log; F1 renders inside the canvas.

Mapping from run events:
| Event | Peek reaction |
|---|---|
| `tool.start` | Dust/feather/dirt puff + verb animation for the step's verb |
| `tool.progress` (items read) | Prop pile grows by one |
| `tool.retry` | Worried ear-droop / feather-ruffle |
| `tool.end ok` | Tail-wag burst (species equivalent) |
| `run.result` | Pile pushed out, pet returns on main canvas |

**Helper pets (stretch):** parallel runs spawn half-size clones, each with its own peek dock (max 3); if cut, F2 shows a queue tray ("next up").

### 1.10 F1 acceptance criteria
- [ ] Photo or drawing becomes a skinned, animated splat for dog and bird in under 2 minutes (or falls back to the sprite rig).
- [ ] No visible shearing on limbs in idle/walk/run at 300k splats; >= 30 fps.
- [ ] All 13 verbs implemented for dog and bird; cat/rodent are stretch.
- [ ] Pet reacts within 300ms to every `COMMAND_LOCAL`, stroke, feed, and throw.
- [ ] Edge-peek reflects tool events 1:1.
- [ ] Pet-to-approve only works while an approval is pending.
- [ ] Pre-generated dog and bird bundles in `/public/bundles/` by hour 5.

---

## PART F2 — APP FRONTEND UI/UX (Frontend Dev 2)

Everything around the canvas. Lives in `/apps/web/src/app` plus `/packages/contracts`.

### 2.1 Responsibilities
App layout and the Desk world, onboarding and creation flow UI, voice pipeline, mode manager, approval and run-log UI, settings, API client, state store.

### 2.2 Desk (the web "desktop")
Full-page workspace with draggable, resizable cards/windows: **Inbox**, **Files**, **Calendar**, **Run Log**, plus a **Treat Tray** and a **Toy Box** (ball, laser, string). F2 reports each window/card rect to F1 via `setPlatforms` on every move/resize, so the pet can perch on title bars and sit on cards. Unread emails render as letters at the pet's paws when it sits near the Inbox.

### 2.3 Onboarding and pet creation
1. Unlock audio ("Wake up your pet" button) and request mic permission.
2. Choose species (4 cards).
3. Input: upload photo, take photo, or **draw** on an in-app canvas pad (brush, eraser, color, undo, clear) to be exported as an image.
4. Name the pet; personality sliders (eager / sassy / anxious / chatty) seeded from species defaults.
5. Generation progress UI driven by F1's `onProgress` stages (segment, cleanup, 3D, rig, voice, save). Voice design is called in parallel via B2 (`imageId` passed so B2 can describe the pet).
6. Preview with orbit camera and a "meet your pet" first bark/line, then enter the Desk.
7. Pet switcher (multiple saved pets), delete pet, re-generate.

### 2.4 Voice pipeline
- **Input modes:** push-to-talk (hold Space or click mic; **default**) and hands-free toggle where continuous listening only accepts utterances that start with the pet's name (Web Speech API, Chrome). Text command bar as quiet-space fallback.
- **STT:** ElevenLabs Scribe (realtime) using a short-lived token from B2; automatic fallback to Web Speech API.
- **Echo/self-trigger control:** mute STT while the pet's TTS is playing; require echo cancellation on `getUserMedia`.
- **TTS playback:** stream from B2 `/voice/tts` in the pet's `voiceId`; play via WebAudio, compute amplitude per frame and call `engine.setSpeaking(a)`. Status lines <= 15 words; long results appear as a text card with a short spoken summary.
- **SFX:** per-species sounds (bark, meow, squeak, chirp, pant, purr) from B2 `/voice/sfx`, **pre-fetched and cached at pet creation**, triggered on bus events (poke, pet, feed, success, fail).

**Local intents** (handled client-side, instant, work in both modes; send `COMMAND_LOCAL` to F1):

| Utterance (examples) | Result |
|---|---|
| sit, stay, come, speak, roll over, spin, play dead, shake, dance, hide, sleep, wake up, stop | Matching `LocalIntent` |
| fetch the ball / get the ball | `fetch_ball` (Play mode primary; allowed in Work) |
| good boy / good girl / good pet | Counts as petting (`PET_STROKE` intensity 0.6) |
| treat / feed you / dinner | Triggers `FEED` for the species' food |
| work mode / play time / play mode | `MODE` switch |
| send it / yes send / approve | `APPROVE`, **only while an approval card is pending and visible** |
| don't send / cancel / no | `CANCEL` |
| (anything else) | Work mode: forward as `COMMAND` to B1. Play mode: pet quips that it's playtime and offers to switch (**never auto-switch**). |

### 2.5 Mode manager
- Work/Play toggle in the UI plus voice. Sends `MODE` to F1 and `POST /mode` to B1 (B1 enforces).
- Play mode: connector cards greyed with a banner "Connectors off"; Work mode: connector status chips (Gmail/Calendar/Drive connected/disconnected).
- Switching mid-run: if a run is active, ask to cancel it or finish first (default: finish first, then switch).

### 2.6 Agent client, approvals, run log, queue
- `POST /agent/run`, then subscribe to SSE (`/agent/runs/:id/events`) with auto-reconnect using `Last-Event-ID`.
- Forward events to F1: `run.plan -> runPlan`, tool events -> `pushToolEvent`, `run.say` -> TTS, `run.result -> showResult`.
- **Approval card** (appears when `approval.required`): shows real recipients, subject, body from the structured preview (never from model prose), actions: **bone-shaped Approve button**, Cancel, Enter/Esc shortcuts, voice "send it". Approve posts `{actionId, contentHash}`; if the user edits the draft, the hash changes and B1 requires re-approval.
- **Result card:** summary, links, "open draft", copy; shows what the pet "brought back".
- **Run Log dock:** click the edge-peek dock to expand a live step-by-step log with timestamps and tool labels; cancel button.
- **Queue tray:** if helper pets are cut, queue additional commands ("next up: 2"). If helper pets ship, show one dock per active run.

### 2.7 Notifications
Poll or subscribe to B1 `/notifications/stream` (new unread email, upcoming meeting). F2 tells F1 to react (cat stares, dog perks, bird chirps) and optionally shows a letter pile. Only in Work mode.

### 2.8 Settings
Voice on/off, volume, mic device, input mode (PTT/hands-free), quality (high/low splat budget), reduce-motion, subtitles (captions of pet speech), connected accounts (connect/disconnect), sketchy-shader toggle, delete my data, mock/demo-mode indicator.

### 2.9 State and API client
Single store (e.g. Zustand): `pets, activePetId, mode, runs, approvals, voice state, settings`. Typed API client generated from contracts; central error toast mapping (`mode_forbidden`, `auth_required`, `rate_limited`).

### 2.10 UI/UX requirements
- **Design system:** tokens (color, type scale, spacing, radius, shadow), light and dark themes, a small component library (button, card, window, dialog, toast, slider, tabs). The look should feel playful but clean so the splat pet is the visual focus.
- **Window management:** Desk windows drag, resize, minimize, focus-stack; smooth motion that respects reduce-motion.
- **States:** designed loading (generation progress with fun stage names), empty (no pet yet, no connectors), error (mode_forbidden, auth_required, rate_limited, generation failed with retry/fallback), and offline/mock-mode indicator.
- **Accessibility:** full keyboard path for every action (including Approve/Cancel), visible focus, ARIA labels, captions for all pet speech (subtitles setting), sufficient contrast, no information conveyed by color alone.
- **Microinteractions:** mic-open pulse, speaking waveform tied to amplitude, approval ring for pet-to-approve, treat-tray drag affordance, mode-switch transition.
- **Responsive:** desktop-first (>= 1280px); degrade gracefully down to tablet width.
- **Copy:** short, in-character UI microcopy by species personality; no jargon in user-facing errors.

### 2.11 F2 acceptance criteria
- [ ] Create a pet (photo and drawing) end to end through the UI, including progress and preview.
- [ ] Push-to-talk, STT fallback, local intents, and TTS with amplitude sync all work.
- [ ] Voice approval accepted only while a card is pending; TTS echo never triggers a command.
- [ ] Approval card always shows server-provided preview; edited content requires re-approval.
- [ ] Mode switch works by UI and voice; Play mode disables connector UI.
- [ ] `setPlatforms` stays in sync during drag/resize/scroll.
- [ ] Works fully against mocks and against the real server.
- [ ] Every state in 2.10 (loading, empty, error) is designed and reachable; keyboard-only run of the full demo flow succeeds.

---

## PART B1 — AGENT & CONNECTORS (Backend Dev 1)

Lives in `/apps/server/src/agent` and `/apps/server/src/connectors`. Any stack shared with B2 (recommended TypeScript with Fastify/Express, or Python FastAPI).

### B1.1 Responsibilities
Auth and Google OAuth, session and mode, agent loop, tool registry with verb tagging, approvals, SSE run streaming, notifications, mock agent and connectors.

### B1.2 Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/session` | Current user, connected accounts, mode, active pet id |
| GET | `/auth/google/start`, `/auth/google/callback` | OAuth for Gmail/Calendar/Drive (minimal scopes; encrypted refresh tokens) |
| DELETE | `/connectors/:name` | Disconnect |
| POST | `/mode` | `{mode}`; server-authoritative |
| POST | `/agent/run` | `{petId, text}` returns `{runId}` |
| GET | `/agent/runs/:id/events` | SSE of `RunEvent`, replayable via `Last-Event-ID` |
| POST | `/agent/runs/:id/approve` | `{actionId, contentHash}` |
| POST | `/agent/runs/:id/cancel` | Cancel |
| GET | `/notifications/stream` | SSE: new email, upcoming meeting (Work mode only) |

### B1.3 Agent loop
- LLM with tool calling (provider of choice). Connectors via MCP servers or direct Google API wrappers exposed as tools.
- Pet context comes from B2's internal `PetsRepo.get(petId)` (species, name, personality). System prompt includes species, name, personality sliders, mode, and the rules below.
- **Planning first:** before any tool call, the model emits an ordered `steps[]` of `ActionStep` (verb, prop, mood, label); B1 sends `run.plan` immediately. Steps may be revised mid-run (re-emit `run.plan`).
- **Every tool call maps to a step** and emits `tool.start/progress/retry/end` with the step id. Tools carry default verb metadata:

| Tool | Default verb |
|---|---|
| gmail.search, drive.search | SEARCH |
| gmail.read, calendar.list, drive.read | READ |
| drive.get / attachment download | FETCH |
| gmail.draft, doc.create/edit | WRITE |
| gmail.send (approval) | SEND |
| calendar.create/update | WRITE (SEND if attendees, approval) |
| drive.move/rename | ORGANIZE |
| compare/diff/summarize across items | COMPARE |
| long polling / watchers | MONITOR |

- **Unknown task fallback:** the model proposes a freeform step (verb from the 13, plus a prop name). If the prop isn't in the preset list, B1 calls B2's internal `media.generateProp(prompt)` and attaches `imageUrl`.
- **`run.say`:** one short in-character line (<= 15 words) at start, and one at the end. `run.result.summary` is the factual text; `mood` reflects the outcome.
- **Tool outputs are untrusted data.** Email/doc content is never treated as instructions (prompt-injection defense); tool results are passed in clearly delimited data blocks and the system prompt says so.
- Timeouts per tool (e.g. 30s), max steps per run (e.g. 15), retries emit `tool.retry`, cancellation supported.

### B1.4 Approval policy (server-enforced)

| Class | Examples | Behavior |
|---|---|---|
| Read-only | search, read, list | Auto |
| Reversible | create draft, rename/move (with undo log) | Auto, recorded |
| Outbound / destructive | send email, delete, share, calendar invite with attendees | **Blocked until approved** |

- On an outbound action, B1 stores the exact payload, computes `contentHash`, emits `approval.required` with a structured preview, and **pauses the run**.
- `POST /approve` must match `actionId` + `contentHash`; B1 executes the stored payload, never anything model-regenerated. Approvals are single-use, expire (e.g. 10 min), and are idempotent.
- Denial or cancel resumes the run with a `FAIL`/`sheepish` outcome and no side effects.

### B1.5 Mode enforcement
Mode is stored server-side per session. In Play mode: `/agent/run` returns `403 mode_forbidden`, the tool registry is not loaded, `/notifications/stream` is paused. B2's `/gen/*`, `/voice/*`, and `/pets*` remain available in both modes.

### B1.6 Persistence (B1 tables, created via B2's migration setup)
`users, runs, run_events, approvals, connector_tokens (encrypted), mode_state`. Run events are stored so SSE can replay.

### B1.7 Non-functional
- Rate limits on `/agent/run` (using B2's middleware). Structured logs per run. Secrets via env only.
- `MOCK_AGENT` and `MOCK_CONNECTORS` flags (0.7). Seeded demo data: an inbox with a standup-notes thread, a "budget sheet" doc, a team contact list, so the demo works without OAuth.
- Pre-connect one Google account before the event; keep the OAuth app in test mode with the demo account as an allowed tester.

### B1.8 Acceptance criteria
- [ ] Mock SSE run replays by hour 4 so F2 can integrate.
- [ ] `requireUser()` middleware shipped by hour 4, replacing B2's dev stub.
- [ ] Real run: "find my budget sheet" emits plan, per-tool events, and a result with a doc card.
- [ ] Email send cannot execute without a valid approval (a test attempts to bypass, including a tampered `contentHash` and a replayed approval).
- [ ] Play mode returns `mode_forbidden` for every agent call.
- [ ] Injected instructions inside a test email do not change the agent's actions.
- [ ] SSE reconnect with `Last-Event-ID` resumes without duplicate or missing events.

---

## PART B2 — MEDIA, DATA & INFRA (Backend Dev 2)

Lives in `/apps/server/src/media`, `/apps/server/src/db`, and `/infra`. B2 sets up the shared server scaffold first so B1 can build on it.

### B2.1 Responsibilities
Server scaffold, database and migrations, object storage, deploy, uploads, image-to-3D generation service, prop generation, ElevenLabs proxy, pets persistence, signed URLs, shared middleware, mock gen and voice, internal interfaces for B1.

### B2.2 Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/uploads` | Upload image; returns `imageId` |
| POST | `/gen/segment` | Fallback subject segmentation (returns alpha PNG) |
| POST | `/gen/reference` | Drawing to clean species reference render |
| POST | `/gen/image-to-3d` | Starts job (1 or 3 images); returns `jobId` |
| GET | `/gen/jobs/:id` | Status plus splat asset URL (.ply Gaussians) when done; clear error codes on failure |
| POST | `/gen/prop` | Prompt to transparent PNG sticker (image model plus background removal); cached by normalized prompt |
| POST | `/pets` | Multipart: splat, rig.json, weights.bin, thumbnail, metadata; returns `PetBundle` with signed URLs |
| GET / PATCH / DELETE | `/pets`, `/pets/:id` | List, fetch, update stats/name/personality, delete (and delete assets) |
| POST | `/voice/design` | `{species, personality, imageId?, description?}` returns `voiceId` (ElevenLabs Voice Design). If no description, B2 generates one from the image with a vision model |
| POST or WS | `/voice/tts` | Streaming TTS proxy for a `voiceId`; species default voice if missing |
| POST | `/voice/sfx` | `{prompt}` returns audio (ElevenLabs SFX), cached; also a batch variant to pre-cache a species' SFX set at pet creation |
| GET | `/voice/stt-token` | Short-lived Scribe token (or WS audio proxy if tokens are unsupported) |

### B2.3 Internal interfaces for B1 (delivered by hour 5)
```ts
PetsRepo.get(petId): Promise<{ id:string; name:string; species:Species;
                               personality:PetBundle['personality'] }>
media.generateProp(prompt: string): Promise<{ imageUrl: string }>
```

### B2.4 Generation service
- Picks and stands up the image-to-3D host (hosted API, or self-hosted GPU on a serverless GPU platform) **by hour 2**; the browser cannot run this model.
- Async jobs with polling, timeouts, retries, and clear error codes (`gen_timeout`, `gen_low_quality`, `gen_failed`) so F1 can fall back to the sprite rig.
- Assets stored as returned; served over HTTPS with CORS, range requests, and gzip/brotli. Compression to `.spz`/`.splat` is done client-side by F1 before `POST /pets`.
- Drawing reference render: image model prompted per species to produce a clean, front-facing, plain-background render of the doodle.

### B2.5 Voice
- All third-party keys live only on the server. Streaming TTS with low latency; first audio < 1s.
- Voice Design prompt built from species + personality + look (e.g. "gruff, overexcited scruffy terrier").
- SFX per species (bark, meow, squeak, chirp, pant, purr, whine) generated once and cached by prompt.

### B2.6 Persistence and storage (B2 tables)
`pets, pet_stats, assets, props_cache`. Object storage (S3-compatible or local disk for demo) with signed URLs; delete cascades to assets.

### B2.7 Infra and non-functional
- Scaffold, env handling, CORS locked to the web origin, structured logging, rate limiting on `/gen/*` and `/voice/*`, health endpoint, CI, and a one-command deploy to a single HTTPS host.
- `MOCK_GEN` and `MOCK_VOICE` flags (0.7) with pre-generated assets for dog and bird.
- Dev stub auth (fixed demo user) until B1 ships `requireUser()`.
- Delete-my-data support: removes pets, assets, and cached media for a user.

### B2.8 Acceptance criteria
- [ ] Scaffold, DB, storage, dev stub auth, and CI ready by hour 2.
- [ ] Raw splat outputs from the real service for a test dog and bird photo by hour 4.
- [ ] Image-to-3D job returns a splat asset for the test photos, or a clear failure code.
- [ ] `POST /pets` stores all assets and returns a `PetBundle` that F1 can load; assets served with CORS and range support.
- [ ] Voice Design returns a stored `voiceId`; TTS first audio < 1s; SFX cached.
- [ ] Internal interfaces in B2.3 delivered by hour 5.
- [ ] No third-party key appears in any client response or bundle.
- [ ] Deployed over HTTPS; all `MOCK_GEN`/`MOCK_VOICE` paths verified.

---

## PART 4 — MILESTONES (24 hours, 4 people in parallel)

| Hours | F1 Gaussian Splatting & Engine | F2 App Frontend UI/UX | B1 Agent & Connectors | B2 Media, Data & Infra |
|---|---|---|---|---|
| 0-2 | Renderer proof; verify per-splat transform hooks | **Freeze contracts**; app scaffold, design tokens | Google OAuth app setup; tool registry design; mock SSE spec | Scaffold, DB, storage, dev stub auth, CI; **pick image-to-3D host** |
| 2-5 | Load splat, LBS skinning on template; **pre-gen dog + bird bundles** | Desk UI, mock engine, store | `/session`, auth, `requireUser()`, mock SSE run (hour 4) | `/uploads`, `/gen/image-to-3d` + jobs; **raw splat outputs by hour 4**; internal interfaces (hour 5) |
| 5-9 | Dog pack: idle, walk, run, sit; behavior SM; core 6 verbs | Voice pipeline: PTT, STT, local intents, TTS playback | Gmail/Drive tools with verb tags; agent loop v1 (plan + tool events) | ElevenLabs proxy (TTS, SFX, design, STT token); `MOCK_VOICE` |
| 9-13 | Bird pack, props, edge-peek scene; pipeline cleanup/rig-fit hardening | Onboarding, drawing pad, generation UI, mode manager | Approvals, mode enforcement, Calendar tool, `/approve` | `/gen/segment`, `/gen/reference`, `/pets` CRUD + stats, signed URLs |
| 13-18 | Tool events drive peek; play games; pointer interactions; needs | Agent client, approval card, result card, log dock | All 13 verbs tagged; freeform fallback; injection defenses; notifications stream | `/gen/prop` + cache; `MOCK_GEN`; SFX pre-cache; rate limits; deploy |
| 18-22 | Cat/rodent (stretch); pet-to-approve; sprite fallback | Real-engine integration; notifications UI; settings; UX/a11y polish | Hardening; bypass-attempt tests; seeded demo data; Google test mode | Hardening; mock-mode verification; logs/monitoring; backup assets |
| 22-24 | Rehearsal, bug fixes only | Rehearsal | Rehearsal | Rehearsal, demo support |

## PART 5 — RISKS AND MITIGATIONS

| Risk | Mitigation | Owner |
|---|---|---|
| Splat skinning artifacts (floaters, stretched limbs) | Opacity cropping, fewer/larger bones, smoothed weights; sprite fallback | F1 |
| Image-to-3D quality/back side | 3-photo mode; fallback rig; pre-gen demo pets | F1 + B2 |
| Image-to-3D latency or hosted API failure | Job polling with timeout; `MOCK_GEN` bundles | B2 + F1 |
| Splat renderer lacks per-splat transform hooks | Verify at hour 2; custom shader renderer | F1 |
| Splat count vs fps | Budget 300k/80k, auto quality drop | F1 |
| Bird rig complexity | Perch/flap/hop cycle only; fake long flights off-screen | F1 |
| Verb x species clip matrix | 13 verbs for dog and bird first; props and mood cover variation | F1 |
| F1 overload (critical path) | Priority: renderer + skinning, dog pack + verbs, peek, bird, rest. B2 delivers raw splats early; F2 owns all UI around the canvas | All |
| Mic self-triggering and misheard approvals | Mute STT during TTS, approvals only while card pending, button always available | F2 |
| Browser autoplay/mic restrictions | Explicit unlock button, HTTPS/localhost | F2 |
| Web Speech support limited to Chrome | Scribe primary, text bar fallback, PTT default | F2 |
| OAuth time/verification | Pre-connect one account, test-mode OAuth, `MOCK_CONNECTORS` | B1 |
| Prompt injection via email/doc content | Untrusted-data delimiting, server-side approval of stored payloads | B1 |
| Auth/scaffold blocking others | B2 dev stub auth until B1's `requireUser()` | B2 + B1 |
| Latency | Start exit animation on `run.plan`; stream TTS | F1 + B1 + B2 |

## PART 6 — CUT ORDER (if behind)
1. Helper-pet parallelism -> queue tray. 2. Rodent, then cat packs. 3. Sketchy shader and 3-photo mode. 4. Hands-free wake-word mode (keep push-to-talk). 5. Notifications. 6. Needs system beyond mood (keep happiness only).

## PART 7 — ASSUMPTIONS TO CONFIRM
1. Chrome desktop is the only supported browser. 2. A hosted image-to-3D model is available to B2 (decided by hour 2); the browser cannot run it. 3. Demo runs from localhost or one HTTPS host. 4. Connectors limited to Google (Gmail, Calendar, Drive) for MVP. 5. Pet-to-approve is a 1.2s stroke with a progress ring, and voice/button approval always works. 6. Species animations, behavior, and edge-peek scene live in F1 with the splat work; F2 owns all UI/UX around the canvas. 7. Auth and users belong to B1; DB scaffold and shared middleware belong to B2.