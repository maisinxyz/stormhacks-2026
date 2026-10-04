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
