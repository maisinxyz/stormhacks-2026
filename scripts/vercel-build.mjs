// Vercel build: one origin serves the desk (work mode, /) and the play app (/camera.html, /overlay.html); the API runs as
// the function in api/index.js. Output goes to dist-vercel/. Run from the repo root.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';

const run = cmd => execSync(cmd, { stdio: 'inherit' });
rmSync('dist-vercel', { recursive: true, force: true });

run('pnpm --filter @fetch/web build');
run('pnpm --filter @fetch/desk build');
// Bundled next to the source so config.ts's ../../web/public/bundles lookup still resolves. sharp is native: left external.
run('pnpm --filter @fetch/server exec esbuild src/integrated.ts --bundle --platform=node --format=esm --target=node24 --external:sharp --outfile=dist/index.js '
  + `--banner:js="import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"`);

mkdirSync('dist-vercel', { recursive: true });
cpSync('apps/desk/dist', 'dist-vercel', { recursive: true });
// The web app's own index.html would overwrite the desk's; the desk is the front door.
if (existsSync('apps/web/dist/index.html')) renameSync('apps/web/dist/index.html', 'apps/web/dist/engine.html');
cpSync('apps/web/dist', 'dist-vercel', { recursive: true });
