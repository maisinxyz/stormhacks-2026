# B1 — Agent & Connectors

Everything in PRD Part B1: auth + Google OAuth, session and mode, the agent loop, Gmail/Drive/Calendar
connectors with verb tagging, approvals, SSE run streaming, notifications, and the `MOCK_*` fallbacks.

Code: `src/auth` (requireUser, OAuth, token crypto), `src/agent` (runner, approvals, SSE, brains, routes),
`src/connectors` (Google REST wrappers, seeded mock workspace).

## Run it

```bash
pnpm install
# Full demo without OAuth or an API key:
MOCK_AGENT=1 MOCK_CONNECTORS=1 pnpm --filter @fetch/server dev:b1      # http://localhost:8787
pnpm --filter @fetch/server test
```

## For B2: mounting B1 in the scaffold

```ts
import { registerB1 } from './agent/plugin';
await registerB1(app, { pets: PetsRepo, media });   // PRD B2.3 interfaces
```

- `pets.get(petId)` → `{ id, name, species, personality }`; `media.generateProp(prompt)` → `{ imageUrl }`.
  Until those exist, `agent/devStubs.ts` has stand-ins.
- `requireUser(config, store)` from `auth/requireUser.ts` replaces the dev-stub auth. It sets `req.user`.
- Persistence: pass `store` implementing `B1Store` (`agent/store.ts`). The DDL is in `agent/schema.sql`.
  The default is in-memory.
- B1 registers `@fastify/cookie` with `SESSION_SECRET` unless a cookie plugin is already registered. If you register it
  yourself, give it the same secret, because cookies are signed.
- SSE responses keep headers set by earlier hooks, so your CORS middleware applies. With cross-origin calls,
  the web app needs `credentials: 'include'` / `withCredentials`; without a cookie, requests act as the demo user.

## For F2: wire behavior

| Endpoint | Notes |
|---|---|
| `GET /session` | `{ user, userName, connected:{gmail,calendar,drive}, mode, activePetId, mock, googleConfigured }` |
| `PATCH /session` | `{ activePetId }` |
| `POST /mode` | `{ mode }` → `{ mode }`. Server-authoritative. |
| `GET /auth/google/start` | Top-level navigation. Redirects back to `WEB_ORIGIN/?connected=google` or `?connect_error=…` |
| `DELETE /connectors/:name` | `google`, `gmail`, `calendar`, `drive`. One grant backs all three, so any of them disconnects all three. |
| `POST /agent/run` | `{ petId, text }` → `{ runId }`. `403 mode_forbidden` in Play, `429 rate_limited` (with `retry-after`). |
| `GET /agent/runs/:id/events` | SSE of `RunEvent`. Unnamed `data:` frames, `id:` = per-run seq. Resume with `Last-Event-ID` (or `?lastEventId=`). The stream closes after `run.result` / `run.error` / `run.cancelled`, and a reconnect after that gets `204`. |
| `GET /agent/runs/:id` | Run snapshot `{ status, steps, … }`. |
| `POST /agent/runs/:id/approve` | `{ actionId, contentHash }` → `{ ok, status: 'approved' \| 'already_approved' }`. Errors: `409 content_hash_mismatch`, `409 approval_not_pending`, `410 approval_expired`, `404`, `403 mode_forbidden`. **Edited draft:** add `edited: { to?, cc?, subject?, body? }`. The response is `409 reapproval_required` with a new `actionId` / `contentHash` / `preview`, and a fresh `approval.required` event is also emitted. |
| `POST /agent/runs/:id/cancel` | While an approval is pending, cancel means "don't send": the run ends with `run.result` mood `sheepish`. Otherwise you get `run.cancelled`. Works in Play mode. |
| `GET /notifications/stream` | Unnamed frames: `{ id, kind:'email'\|'meeting', title, detail, time, at, unread }`. The named `status` event carries `{ paused, connected? }`. Nothing is delivered in Play mode. |

Event guarantees: `run.plan` comes before any `tool.*`, and every `tool.*` `stepId` is in the latest `run.plan`. The plan is
re-emitted when steps are added or a generated prop sticker arrives. `run.say` is ≤ 15 words.

## Any app via Composio

Set `COMPOSIO_API_KEY` in `apps/server/.env` (gitignored) and the agent can work in any app Composio supports: Gmail,
Google Drive/Calendar/Sheets, Slack, GitHub, Notion, Linear, and hundreds more. You don't need a Google OAuth app.

- **Tools:** the agent gets `apps.search` and `apps.execute` instead of the native Google tools.
  - `apps.search` finds exact tool slugs, their input schemas, and connection status.
  - `apps.execute` runs the chosen tools in order.
- **Automatic connect:** if a tool's app isn't connected, the run pauses with `approval.required` (`kind: 'other'`).
  - The card's `preview.body` is the Composio sign-in link, and `preview.summary` says which app it is.
  - As soon as the user finishes signing in, the run continues on its own.
  - Calling `/approve` before the account is connected returns `409 not_connected_yet`. Cancel declines the connection.
  - **F2:** render `preview.body` as a link when it starts with `https://`.
- **Approvals:** a call runs automatically only if Composio tags it `readOnlyHint` and not `destructiveHint`.
  Anything else (send, post, create, update, delete) goes to the normal approval card, whose preview shows the exact
  tool and arguments that will run. App-tool approvals can't be edited.
- **`/session` additions:** `composio: true` and `apps: string[]` (connected app slugs). The `connected` chips map to
  the Composio apps `gmail`, `googlecalendar` and `googledrive`.
- **Disconnecting:** `DELETE /connectors/:name` accepts `gmail`, `calendar`, `drive`, or any Composio app slug.
- **Which tools run:** `MOCK_CONNECTORS=1` (or `MOCK_AGENT=1`, whose canned scripts drive the native tools) uses the
  offline native tools even when a key is set.

## Config (env)

| Var | Default | |
|---|---|---|
| `MOCK_AGENT` / `MOCK_CONNECTORS` | off | Scripted agent / seeded Gmail-Drive-Calendar. These are also the demo fallbacks. |
| `MOCK_AGENT_DELAY_MS` | 700 | Pacing between mock agent turns. |
| `MOCK_NOTIFY_ARRIVAL_MS` | 20000 | Mock "new email" arrival after the notifications stream connects. |
| `ANTHROPIC_API_KEY` | | Needed for the real agent. |
| `COMPOSIO_API_KEY` | | Any-app tools with automatic connect (see above). |
| `COMPOSIO_CALLBACK_URL` | `WEB_ORIGIN/?connected=app` | Where the browser lands after an app sign-in. |
| `AGENT_MODEL` / `AGENT_EFFORT` | `claude-opus-5-5` / `low` | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | | OAuth app in test mode, with the demo account as a tester. Redirect: `…/auth/google/callback`. |
| `WEB_ORIGIN` | `http://localhost:5173` | Where OAuth redirects back to. |
| `SESSION_SECRET` | dev-only | Signs cookies. **Set it in any deploy.** |
| `TOKEN_ENC_KEY` | derived | 32-byte base64 key for encrypting refresh tokens. |
| `REQUIRE_LOGIN` | off | Reject cookie-less requests instead of acting as the demo user. |
| `AGENT_RUN_RATE_MAX`, `AGENT_MAX_STEPS`, `TOOL_TIMEOUT_MS`, `APPROVAL_TTL_MS`, `NOTIFY_POLL_MS` | 10/min, 15, 30s, 10min, 30s | |

## Safety model

- **Approvals:** outbound or destructive tools (`gmail.send`, `drive.share`, `drive.trash`, and calendar
  create/update with attendees) pause the run. The exact payload is stored and hashed. Only a matching
  `actionId` + `contentHash` executes it, once, and what executes is the *stored* payload. Anything that needed approval
  is never auto-retried. Previews for file actions show the real file name (looked up server-side), not the model's.
  Edits to fields a tool doesn't have are rejected, never dropped.
- **Mode:** Play mode blocks `/agent/run` and `/approve`, and the runner re-checks mode before every connector call.
- **Prompt injection:** tool output reaches the model only inside escaped `<untrusted_data>` blocks, under a
  system rule that it is data, never instructions. Even if the model is fooled, any send still needs a human
  approval that shows the real recipients. The seeded inbox has an injection email, and `llm.test.ts` runs a live check when
  `ANTHROPIC_API_KEY` is set.
- Refresh tokens are AES-256-GCM encrypted at rest. Cookies are signed and httpOnly. Email headers are CR/LF-stripped.
