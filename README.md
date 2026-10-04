# Fetch / StormHacks 2026

## Run the Desk and Play apps locally

The Desk and Play experiences are separate Vite apps. The recommended command
starts both servers together:

```bash
# From the repository root
npm run dev
```

This starts Play on port `5174` and Desk on port `5173`. Keep this command
running while using the site.

If you prefer separate terminals, run `cd apps/web && npm run dev` and
`cd apps/desk && npm run dev`.

Open http://localhost:5173/. Pressing **Play** opens the Play shell at
http://localhost:5174/camera.html and carries the selected pet ID across.

For a deployed Play origin, set `VITE_PLAY_APP_URL` before starting Desk. In
production, Desk uses the same-origin `/camera.html` path unless configured.

## Deploying the web app

Vercel builds the Desk app and merges the Play entry points into the same static
output. Set `VITE_FETCH_API_URL` in the Vercel project to the public HTTPS URL
of a separately deployed Fetch server; the browser uses that value for pets,
generation, agent, and voice requests. `VITE_PLAY_APP_URL` is optional when
Play is served from the same Vercel deployment.

The Fetch server is not a Vercel static function: it uses Fastify, SQLite, local
asset storage, long-running generation jobs, and provider API keys. Deploy it
on a persistent Node/container host, then set `PUBLIC_URL`, `WEB_ORIGINS` (the
Vercel origin), `HOST=0.0.0.0`, `SESSION_SECRET`, `ASSET_SIGNING_SECRET`, and
the provider keys from `apps/server/.env.example` on that server. Never commit
those values or put server-only keys in Vercel's `VITE_*` variables.
