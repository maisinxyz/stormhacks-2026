# Fetch B2 server

TypeScript + Fastify 5, Node 24, SQLite (built-in `node:sqlite`), and local private assets. B2 owns the scaffold, `src/db`, `src/media`, and infra. B1 owns auth, agent, connectors, session/mode, and notifications. Shared F2 contracts and F1 engine files are untouched.

## Start locally

From `apps/server`:

```powershell
Copy-Item .env.example .env
corepack.cmd pnpm --filter @fetch/server... install --frozen-lockfile
corepack.cmd pnpm dev
```

On macOS/Linux use `cp .env.example .env` and `corepack pnpm` instead. The example enables all four `MOCK_*` flags. The combined entry point uses B1 authentication; `REQUIRE_LOGIN=0` enables its demo-user fallback. `DEV_AUTH` only applies when running the B2-only `buildApp` scaffold. Server: `http://localhost:3001`; health: `/health`. No credentials are needed for mocks. Dependencies use the shared pnpm lockfile, retaining B1 dependencies and workspace contracts.

Checks: `corepack.cmd pnpm typecheck`, `corepack.cmd pnpm test`, `corepack.cmd pnpm build`. `test` runs B1's Vitest suite and B2's Node tests. The build bundles local TypeScript imports with esbuild, retaining B1's extensionless imports without rewriting teammate files. Node's SQLite module may emit an experimental warning.

## B1 integration

`src/index.ts` starts the combined B1/B2 server through `buildFetchApp` in `src/integrated.ts`. To supply a persistent B1 store or other B1 options:

```ts
import { buildFetchApp } from './integrated.js';
const { app, context } = await buildFetchApp({ b1: { store: yourB1Store } });
await app.listen({ host: context.config.HOST, port: context.config.PORT });
```

The integration wrapper registers B1's signed-cookie parser at the parent scope, uses B1's `requireUser` for media requests, and checks pet ownership before an agent run. Background agent tasks inherit a per-user async context, so B1-generated props are cached for the correct user. B1's implementation files are unchanged.

With login required, `/auth/google/start` can create a pending identity for signed OAuth state without granting a session or media access. Existing authenticated users retain their identity when reconnecting. B1 validates the callback and creates the actual session.

`context.pets.get(petId)` implements PRD `PetsRepo.get`: `{id,name,species,personality}`. This remains a trusted internal lookup; the combined wrapper checks ownership using `context.pets.getBundle(petId, userId)`.

`context.forUser(userId).media.generateProp(prompt)` implements B1's `media.generateProp(prompt)` with a user-scoped cache. `context.db` provides SQLite prepared statements and migrations. `src/db/index.ts` exports `transaction(db, fn)` for synchronous transactions; future B1 SQLite migrations can use `schema_migrations` versions >=100. B1 currently defaults to `MemoryStore`; its users, modes, tokens, runs, and SSE events do not survive restart. B1's supplied `schema.sql` uses PostgreSQL syntax and cannot be executed directly against this SQLite database. Supply a B1Store adapter to add persistent agent storage. B2 pets, jobs, and media already persist.

`context.deleteUserMedia(userId)` deletes B2 pets, stats, upload/job assets, prop/SFX caches, and local voice metadata. B1's delete-account flow must also remove B1 sessions, tokens, runs, and approvals. Provider retention and deletion of provider-side voices are separate follow-up work; local deletion does not claim to erase third-party histories.

Production refuses B2 dev auth, requires a stable asset-signing secret, and the combined entry point forces `REQUIRE_LOGIN=1` with a session secret of at least 32 characters. `buildApp` remains available for B2-only tests or custom integration.

## F1/F2 HTTP contracts

Protected routes require B1's session cookie, or explicit development stub auth. F1 can set engine API base to `http://localhost:3001`, with `credentials: 'include'`. CORS is restricted to `WEB_ORIGINS`. Origin checks reject unlisted browser origins before mutations. No Work/Play restriction on these media routes, as required by PRD B1.5.

| Endpoint | Request | Response |
|---|---|---|
| `POST /uploads` | multipart `image` | `{imageId}` |
| `POST /gen/segment` | multipart `image` | alpha-capable `image/png`; free-tier quota: `429 {code:'gen_quota',message,retryAfter}` + `Retry-After` |
| `POST /gen/reference` | `{imageId,species,kind?}`; `kind` `'drawing'` (default) or `'photo'` | `{imageId}` of a standing, full-body, side-view photoreal reference on a plain background; free-tier quota: `429 {code:'gen_quota',message,retryAfter}` + `Retry-After` |
| `POST /gen/image-to-3d` | `{imageIds:[id] or [front,side,back],species}` | `{jobId}` |
| `GET /gen/jobs/:id` | poll about once/second | `{status:'pending'}` / `{status:'done',splatUrl}` / `{status:'failed',error,retryAfter?}` (`retryAfter` seconds, with `gen_quota`) |
| `POST /gen/prop` | `{prompt}` | `{imageUrl}` |
| `POST /pets` | multipart files `splat,rig,weights,thumbnail`; string field `metadata` containing JSON | `201 PetBundle` |
| `GET /pets` | — | `PetBundle[]` |
| `GET /pets/:id` | — | `PetBundle` |
| `PATCH /pets/:id` | optional `name,personality,stats,voiceId`; personality/stats may be partial | refreshed `PetBundle` |
| `DELETE /pets/:id` | — | `204`; removes bundle assets and stats |
| `DELETE /pets` | explicit delete-my-media action | `204`; deletes all B2 user media |
| `POST /voice/design` | `{species,personality?,imageId?,description?}` | `{voiceId}` |
| `POST /voice/tts` | `{text,voiceId?,species?}` | streamed MP3; species defaults to dog if omitted |
| `POST /voice/sfx` | `{prompt}` | `{audioUrl}` |
| `POST /voice/sfx/batch` | `{prompts:[...]}` (max 8) | `{items:[{prompt,audioUrl}]}` |
| `GET /voice/stt-token` | — | `{token,expiresIn:900}`, single use, one per mic turn (30 a minute). Mock or no key returns `503`: the clients have no other recognizer, so the mic reports that voice is unavailable |

Species: `dog,cat,rodent,bird`. Metadata requires `name,species`; optional personality/stat values receive species defaults. Stats 0–100, personality 0–1. Voice IDs must have been designed for the current user or be configured species defaults. Save the design result with pet creation metadata or `PATCH /pets/:id`.

Error JSON: `{code,message}`; validation includes field paths. Generation codes: `gen_timeout`, `gen_low_quality`, `gen_failed`, `gen_quota` (free HF GPU quota or queue full; retry later), `gen_interrupted` (server restarted during a free HF run; retry). A zero-config deployment defaults to `MOCK_GEN=1` so the demo does not fail all jobs; set `MOCK_GEN=0` explicitly only when the live provider and its credentials are configured. Every protected response includes `X-Fetch-Mock-Gen` and `X-Fetch-Mock-Voice` headers. `/health` exposes these flags for F2's demo indicator.

Uploads accept PNG/JPEG/WebP, normalize orientation and strip metadata, and reject oversized/animated/invalid images. The limit is 16 MB per file, 32 MB aggregate, 16 million input pixels. Bundle splats are 32 bytes each, <=300,000; weights are 8 bytes per splat with valid bone indices and sum 255; rig is JSON with 1–256 ordered bones. The endpoint supports F1's `.splat` format, including its current sprite fallback converted to Gaussians; it does not accept `.spz` or standalone layered-sprite files.

Asset URLs use expiring HMAC authorization and HTTPS when `PUBLIC_URL` is HTTPS. Range requests, gzip/brotli for splat/JSON, and CORS are supported. Fetching a pet/job renews URLs. Keep `ASSET_SIGNING_SECRET` stable to preserve URLs across restarts. Assets are stored as original generated Gaussian PLY or client-encoded `.splat`; B2 does not run cleanup/rigging/compression.

## Providers and live verification

3D (free, default): the public Hugging Face Space [`trellis-community/TRELLIS`](https://huggingface.co/spaces/trellis-community/TRELLIS) through `@gradio/client` on ZeroGPU: `/preprocess_image` (background removal + crop) per photo, `/generate_and_extract_glb`, then `/extract_gaussian`. Three photos use the Space's multi-image mode. `/gen/image-to-3d` returns `{jobId}` at once and the run continues in the server process; polls stay `pending` until the `.ply` (~260k Gaussians, ~17 MB, up axis -Y; F1 handles orientation) is validated and stored. Files are downloaded only from the configured Space's exact `*.hf.space` host. An in-process run cannot survive a restart, so a pending HF job polled after a restart fails with `gen_interrupted`. Anonymous use is roughly one generation per day (each run reserves 120 s of GPU); a quota error fails the job with `gen_quota` plus `retryAfter`, and later calls fail fast until then. Set `HF_TOKEN` to raise the quota. Without `FAL_KEY`, `/gen/segment` also uses the Space's `/preprocess_image`.

Reference images (free, default without `FAL_KEY`): the public Space [`black-forest-labs/FLUX.1-Kontext-Dev`](https://huggingface.co/spaces/black-forest-labs/FLUX.1-Kontext-Dev) `/infer` (instruction-based image editing, 28 steps, fixed seed). `kind:'drawing'` turns a doodle into a photorealistic dog/cat that keeps its colors, markings and body shape; `kind:'photo'` re-poses a sitting/lying pet as standing while keeping its fur, markings, face and eye color. Both ask for a single standing animal, full-body side view, on a plain light-gray background, which is what TRELLIS reconstructs best. Input is flattened onto white and capped at 1024 px. One edit took ~28 s live with a token (each run reserves ZeroGPU time from the same quota as TRELLIS). Downloads are limited to that Space's host; quota maps to `429 gen_quota` with `retryAfter`, and later free calls fail fast until then. The request is synchronous with a 120 s deadline (`gen_timeout`).

| Variable | Default | Purpose |
|---|---|---|
| `IMAGE_TO_3D_PROVIDER` | `replicate` if `REPLICATE_API_TOKEN` is set, else `hf` | `hf` (free Space) or `replicate` (paid) |
| `HF_TRELLIS_SPACE` | `trellis-community/TRELLIS` | Space id (`owner/name`); downloads are limited to its `owner-name.hf.space` host |
| `HF_EDIT_SPACE` | `black-forest-labs/FLUX.1-Kontext-Dev` | Free `/gen/reference` Space (must expose Kontext's `/infer(input_image,prompt,seed,randomize_seed,guidance_scale,steps)`); used only when `FAL_KEY` is unset |
| `HF_TOKEN` | empty (anonymous) | Optional `hf_...` token for more ZeroGPU quota (shared by both Spaces); server-only |
| `GEN_TIMEOUT_MS` | `300000` | Job deadline; the free queue can wait |

3D (paid, optional): [Replicate firtoz/TRELLIS schema](https://replicate.com/firtoz/trellis/api/schema), pinned version in `.env.example`. Uses `save_gaussian_ply=true`, disables mesh/video generation, supports one or three input images. Predictions persist in SQLite and polls resume after server restarts. Poll requests retry up to three times; prediction creation is not automatically retried to avoid duplicate paid jobs. Timed-out predictions are canceled on the next poll. Generated outputs are copied to local private storage, with Gaussian-header validation before F1 receives them.

Images: [fal rembg](https://fal.ai/models/fal-ai/imageutils/rembg/api), [FLUX dev image-to-image](https://fal.ai/models/fal-ai/flux/dev/image-to-image/api) for references when `FAL_KEY` is set (same prompts as the free path), and FLUX schnell followed by rembg for transparent props. fal calls use its durable queue. Provider URLs are restricted to known HTTPS media hosts; redirects are rejected.

Voice: [ElevenLabs streaming TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/stream), Voice Design followed by voice creation, Sound Effects, and single-use realtime Scribe tokens. Speech bytes stream directly to the client without full buffering. Keys stay on the server. If `imageId` is supplied without a description, a vision endpoint describes the pet; configure `VISION_*` or provide `description`. No separate vision key is required when using descriptions.

Set `MOCK_GEN=0` to enable real generation: photo-to-3D, segmentation, and drawing/photo references work free through HF Spaces with no keys; `FAL_KEY` adds props (and switches segmentation and references to fal); `REPLICATE_API_TOKEN` switches 3D to Replicate. Set `MOCK_VOICE=0` with `ELEVENLABS_API_KEY` and default species voice IDs (or design a voice). These live services have NOT been exercised without credentials. Real dog/bird photo generation, visual quality, <2 minute generation, and <1 second first audio need measurement against the selected accounts before the demo.

Mock generation converts F1's existing dog/bird `.splat` assets to Gaussian PLY. It returns the input for reference/segmentation; it does not pretend to infer 3D from a photo. Props use one transparent document placeholder. Mock voice/SFX return a short fixed WAV chime, not actual speech. Cat/rodent mock generation returns a clear failure. These limitations are visible through flags.

## Later deployment

`infra/compose.yaml` and `infra/Dockerfile` package the service; no deployment was performed. Use a persistent Node/container host with TLS and a mounted data volume. A single service can also serve the built web app later, once F1/F2 agree on which web entry point ships. Set `HOST=0.0.0.0`, HTTPS `PUBLIC_URL`, exact `WEB_ORIGINS`, stable signing secret, and B1 auth integration.

The current SQLite/local-disk design assumes one server replica. Vercel frontend hosting is possible later, but the backend needs durable external database/storage and job coordination before moving to ephemeral functions. CI checks live in `.github/workflows/b2-server.yml` and run server tests, typechecking, compiled smoke checks, and a Docker image build.

See [the B2 commit audit](../../docs/B2-AUDIT.md) for verified behavior, fixes, and remaining PRD/integration gaps. Passing mock backend tests does not establish a complete real-service Desk demo.
