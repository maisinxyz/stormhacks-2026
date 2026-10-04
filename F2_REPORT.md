# Fetch F2 completion report

## Completed

The remaining F2 work is implemented in `apps/desk`:

- 2.5 Mode manager: Work/Play switching, connector-off banner, active-run protection, server mode call, and Work-only notifications.
- 2.6 Agent client: typed API client, mock SSE-style run stream, plans, tool events, TTS status lines, approval flow, cancellation, run log, and queue tray.
- 2.7 Notifications: typed notification state, unread email/meeting panel, and F1 reaction-ready event boundary.
- 2.8 Settings: voice, volume, PTT/hands-free, splat quality, themes, subtitles, reduced motion, sketchy shader, demo indicator, and delete-data affordance.
- 2.9 State/API: centralized Fetch store for pets, mode, runs, approvals, notifications, settings, and voice state.
- 2.10 UI/UX: draggable/resizable Desk windows, focus stacking, platform rectangles sent to the engine, keyboard Escape/Enter paths, focus-visible controls, responsive layout, light/dark themes, reduced-motion handling, loading/empty/approval/error states, captions, and demo-mode labeling.
- 2.11 acceptance pass: the Desk package builds cleanly and the shared contracts package typechecks.

## How to check locally

```bash
cd apps/desk
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

Useful checks:

1. Switch Work / Play. Play mode should show `Connectors off` and suppress notifications.
2. Type `find my budget sheet` and press Enter. Open the Peek dock to see the Run Log.
3. Type `email the standup notes to my team`. The approval card should show the structured recipient, subject, body, Approve, and Cancel actions.
4. Use Enter/Escape on the approval card.
5. Open Settings and test theme, subtitles, reduced motion, voice mode, and quality toggles.
6. Drag a Desk window by its header and resize it from the lower-right handle. The engine platform contract is updated on every change.
7. Click Notifications in Work mode, then repeat in Play mode to verify the guard.

## Integration map

### F1 — engine owner

Connect `apps/desk/src/App.tsx` to the real engine through the `PetEngine` boundary:

- `setMode(mode)` when Work/Play changes
- `setPlatforms(rects)` when Desk windows move or resize
- `runPlan(steps)` on `run.plan`
- `pushToolEvent(event)` on tool events, approvals, results, errors, and cancellation
- `setApprovalPending(true/false)` around approval cards
- `setSpeaking(amplitude)` while TTS plays

The current Desk uses `MockPetEngine` so UI work remains runnable before F1 is mounted.

### B1 — agent/connectors owner

The API client is prepared for:

- `POST /mode`
- `POST /agent/run`
- `GET /agent/runs/:id/events` (SSE)
- `POST /agent/runs/:id/approve` with `{ actionId, contentHash }`
- `POST /agent/runs/:id/cancel`
- `GET /notifications/stream`

B1 should preserve the `RunEvent` payloads from `packages/contracts` and confirm that SSE reconnection uses `Last-Event-ID` before replacing the mock fallback.

### B2 — media/voice/data owner

The current F2 voice layer remains browser-safe until B2 is available. Wire these next:

- `/voice/stt-token` for Scribe, with Web Speech as fallback
- `/voice/tts` for streamed pet speech and amplitude analysis
- `/voice/sfx` for cached species reactions
- `/pets` and `/pets/:id` for the centralized pet list, active pet, stats, and creation flow
- `/session` for connected account state and active pet

### Shared contracts

`packages/contracts/src/index.ts` is the source of truth. `apps/desk/src/contracts.ts` currently mirrors the client-facing types so the Desk can build independently; once the workspace package manager is available, replace the local import with `@fetch/contracts` and remove the duplicate definitions.

## Verification status

- `apps/desk`: `npm run build` — passed.
- `packages/contracts`: `npm run typecheck` — passed.
- `apps/web`: typecheck is currently blocked by missing workspace installation (`@fetch/contracts`, `three`) and unavailable `pnpm` in this environment. This is repository setup work, not a F2 source error.
