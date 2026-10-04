# B2 commit audit against the Fetch PRD

Reviewed commit: `fcb8bd50b583ba5c9b7fe42244c34b95ea8a511f` (`B2`), against its parent and `PRD.md`. Audit performed October 3, 2026. Fixes are local working-tree changes; no commit, push, deployment, real email send, or paid media generation was performed.

## Verdict

The B2 backend works through the exercised mock HTTP flows after the fixes below. **Fetch does not yet meet all PRD requirements or have a verified end-to-end production demo.** Backend tests must not be treated as proof that the Desk UI is integrated or that real services meet the quality and latency targets.

## Bugs corrected

| Issue | Impact in the pushed commit | Correction and evidence |
|---|---|---|
| CORS omitted PATCH and DELETE | A frontend on the configured separate origin cannot update pet stats/name/personality, delete pets/media, update the session, or disconnect connectors. Direct HTTP tests previously concealed this. | Explicit allowed methods in `apps/server/src/app.ts`. A browser-preflight regression failed before the fix and passes afterward. |
| Strict login blocked its own OAuth entry point | Production forces login, but B1's Google-start route required an existing session. A new user received 401 before reaching Google. | `apps/server/src/integrated.ts` allows a pending, random identity only at OAuth start. B1 still signs/checks OAuth state and creates the session at successful callback. Regression verifies redirect, no session/user creation at start, invalid-state rejection, anonymous media denial, and preservation of an existing user's identity. Failed before the fix; passes afterward. |
| Provider 5xx permanently failed recoverable 3D jobs | Three unsuccessful status requests marked a durable prediction failed, even if the upstream job later succeeded. | Provider HTTP 5xx is classified as `provider_unavailable`; existing jobs remain pending and can recover, subject to the existing overall timeout. Regression simulates 503 followed by successful output. Failed before the fix; passes afterward. Explicit provider terminal failures and invalid Gaussian output still fail. |
| Dockerfile prepared pnpm without enabling its executable shim | Later bare `pnpm` instructions rely on a shim the Dockerfile did not install. | Added `corepack enable pnpm`. CI now builds the Docker image and triggers for root manifest/ignore changes too. This correction was inspected against Corepack documentation; container execution remains unverified locally because Docker's daemon is stopped. |

Expanded compiled-server smoke coverage to upload an image, generate both mock dog and bird PLY outputs, and fetch signed assets. This verifies the built entry point's bundle paths rather than relying only on TypeScript imports.

## PRD requirement coverage

"Verified" below means the stated automated/source check passed, not a live provider or visual acceptance run.

| PRD | Status | Evidence or remaining work |
|---|---|---|
| B2.1 scaffold, DB, local storage, middleware | Verified for local/mock operation | Fastify, versioned SQLite migration, local private asset store, authentication integration, origin allowlist, structured logger, limits, health route. |
| B2.2 upload and generation endpoints | Implemented; mock flows verified | All listed paths exist. Uploads normalize PNG/JPEG/WebP; polling enforces ownership and returns clear terminal generation codes. Real adapters use injected provider responses in tests. |
| B2.2 pet CRUD, stats and signed URLs | Verified for current F1 `.splat` bundles | Real F1 dog assets and generated photo/drawing pipeline outputs are accepted. Tests cover ownership, metadata/stats updates, signed reads, ranges, compression, deletion, and persistence across restart. `.spz` uploads are not supported; current F1 uses `.splat`, which the PRD also permits. |
| B2.2 voice design, TTS, SFX, STT token | Implemented; mock/injected responses verified | Voice IDs stored and checked by user; streamed TTS; normalized per-user SFX cache; batch route; single-use token proxy. Mock STT returns 503 for browser/text fallback. Real voice design and audio quality are unverified. |
| B2.3 internal interfaces | Verified | Pets repository returns identity/species/personality; B1's background prop work retains the authenticated user's scope. |
| B2.4 asynchronous generation, timeout, retries, failures | Partially verified | Predictions persist, polling retries, terminal codes and transient recovery are tested. Generation creation is intentionally not retried to avoid duplicate paid jobs. Timeout cancellation happens on a subsequent poll; abandoned jobs have no scheduled cleanup worker. Real quality and 1–2 minute generation remain unverified. |
| B2.4 asset serving | Verified locally | CORS, signed access, byte ranges, gzip/brotli are tested. HTTPS depends on host/TLS configuration and has not been deployed or tested. |
| B2.5 species/personality/look voice prompts | Implemented | Prompt includes species/personality and description or server-side vision output. Live vision/voice performance remains unverified. |
| B2.5 first audio under 1 second | Unverified | Streaming implementation alone does not establish the latency target. Measure using the actual account and deployed path. |
| B2.5/B2.2 SFX generation/cache and creation-time pre-cache | Partial | Cache and explicit batch endpoint exist. Pet creation does not automatically pre-cache a species SFX set, and current onboarding does not call the batch endpoint. |
| B2.6 pets, stats, assets, props cache and cascading deletion | Verified locally | Tables and ownership checks exist. Tests verify pet asset deletion and all-media cleanup, including caches and in-flight-work coordination. |
| B1.6 shared persistence | Incomplete | B1 defaults to `MemoryStore`. Users, Google tokens, mode, runs, events and approvals disappear on restart. Its PostgreSQL DDL is not integrated with B2's SQLite migration system. In production, a restart can invalidate a user's login and a subsequent login can create a new identity, leaving old pets inaccessible. |
| B2.7 CI | Configured; checks run locally | Server typecheck, both test suites, build and compiled smoke pass. New Docker build step has not run in GitHub Actions during this audit. |
| B2.7 one-command HTTPS deployment | Incomplete | Compose launches only the backend on HTTP port 3001. It does not build/serve the frontend or provision TLS. A TLS host/reverse proxy and frontend deployment are still required. |
| B2.7 mock generation and voice | Verified with documented limitations | Dog/bird generation returns existing Gaussian assets. Segmentation/reference pass through input; props are a placeholder; voice/SFX are a fixed chime. Cat/rodent mock 3D fails explicitly; they are stretch species. |
| B2.7 delete-my-data | Partial | `DELETE /pets` removes B2 user media. B1 tokens/runs/users and upstream voice/history deletion are not included. Desk's delete-data button has no handler. |
| B2.8 real dog/bird raw output and deployed acceptance | Unverified | No live provider requests or HTTPS deployment were performed. Mock conversion of existing assets is not evidence of successful real photo inference. Hour-based milestone deadlines cannot be established from this audit. |
| 0.10 no client API keys | Source checks and sentinel-response checks passed | Provider keys are read on the server and sent in upstream headers. Adapter tests check sample private credentials are absent from generation responses. This does not substitute for inspecting a future deployed client bundle/configuration. |
| 0.10 approvals and Play enforcement | Automated backend checks passed | Existing B1 security tests and combined-server tests cover tampered hashes, single execution/replayed approval, and Play denial while media remains available. Live prompt-injection test is skipped without credentials. |
| 0.10/0.11 full demo, latency and FPS | Incomplete/unverified | Frontend integration gaps below prevent claiming a full real-service demo. Browser animation timing, audio timing, keyboard flow and FPS were not measured here. |

## Integration gaps outside the B2 changes

These are findings, not fixes to teammates' directories.

1. `apps/desk/src/App.tsx` uses `MockPetEngine`; onboarding makes a local pet with empty asset URLs and an ID the backend does not know. It does not call F1's generation pipeline or B2 pet persistence. The backend consequently rejects those pet IDs for real agent runs.
2. `apps/desk/src/api.ts` uses relative URLs with no Vite proxy configured. When running the separate development frontend, calls reach the frontend origin. HTTP/network failures silently produce demo runs; mode/approval/cancel methods do not check successful HTTP status. A visible demo success can conceal a rejected server action. Cross-origin cookie credentials are also missing, and SSE closes on error instead of reconnecting.
3. Desk session and notification methods return hardcoded data. Pet speech uses browser speech synthesis, rather than B2 Voice Design/TTS/SFX/Scribe integration. Voice IDs are not designed or assigned during onboarding.
4. In `apps/web/src/engine/pipeline/generate.ts`, segmentation still processes the original input rather than the generated drawing reference. Its segmentation response status is not checked before reading a blob. Error JSON can become the sprite fallback's image input. The current integration tests exercise successful mocks, so they do not establish correct real drawing fallback behavior.
5. `apps/web` is an engine demonstration and `apps/desk` is a separate UI demonstration. The repository does not yet expose the complete PRD demo through a unified integrated entry point.

## Validation performed

- Complete server test command: **51 B1 tests passed, one existing live-provider test skipped; 22 B2/integration tests passed**.
- Server TypeScript check: passed.
- Server esbuild bundle: passed.
- Compiled server smoke: passed, including startup, session, pets, dog/bird mock generation, signed asset downloads, and streamed mock audio.
- F1/web TypeScript check: passed.
- Desk TypeScript/production build: passed.
- Git whitespace/diff check: passed for code changes.
- Missing frontend dependencies were installed from the existing lockfile; the lockfile was not changed. Windows sandbox access failures were rerun outside the sandbox and successful results are reported above.
- Docker daemon was unavailable even outside the sandbox, so no container build/run result is claimed.
- No paid providers, real Google OAuth completion, deployed HTTPS environment, or interactive browser demo was exercised.

## Files covered from the commit

All 28 changed files were included in the review. Code paths were read directly; dependency/config changes were inspected through their diff and exercised where possible.

| Group | Files |
|---|---|
| Repository/build configuration | `.dockerignore`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.github/workflows/b2-server.yml` |
| Server configuration and documentation | `apps/server/.env.example`, `.gitignore`, `README.md`, `package.json`, `tsconfig.json` |
| Server entry/integration | `apps/server/src/app.ts`, `config.ts`, `errors.ts`, `index.ts`, `integrated.ts` |
| Database | `apps/server/src/db/index.ts`, `pets.ts` |
| Media | `apps/server/src/media/mock.ts`, `providers.ts`, `routes.ts`, `service.ts`, `storage.ts`, `types.ts`, `user-work.ts` |
| Tests | `apps/server/test/integrated.test.ts`, `media.test.ts`, `smoke.mjs` |
| Infrastructure | `infra/Dockerfile`, `infra/compose.yaml` |

Provider contract references checked: [TRELLIS predictor source](https://raw.githubusercontent.com/firtoz/TRELLIS/main/predict.py), [fal background removal](https://fal.ai/models/fal-ai/imageutils/rembg/api), [fal drawing reference](https://fal.ai/models/fal-ai/flux/dev/image-to-image/api), [fal sticker generation](https://fal.ai/models/fal-ai/flux/schnell/api), [ElevenLabs Voice Design](https://elevenlabs.io/docs/api-reference/text-to-voice/design), [ElevenLabs single-use token](https://elevenlabs.io/docs/api-reference/tokens/create), and [Corepack](https://github.com/nodejs/corepack). These support schema/configuration inspection, not a claim that the pinned models or accounts were exercised successfully.
