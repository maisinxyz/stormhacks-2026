FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack prepare pnpm@12.9.1 --activate
RUN corepack enable pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desk/package.json apps/desk/package.json
COPY packages/contracts packages/contracts
RUN pnpm --filter @fetch/server... install --frozen-lockfile
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/server/src apps/server/src
COPY apps/web/public/bundles apps/web/public/bundles
RUN pnpm --filter @fetch/server build

FROM node:24-bookworm-slim
WORKDIR /app/apps/server
# Preserve pnpm's relative links and B1's workspace contract package.
COPY --from=build /app /app
RUN mkdir -p /app/apps/server/data && chown node:node /app/apps/server/data
# Hosts mount the data disk owned by root, so start as root, hand the disk to `node`, then drop to it for the server itself.
ENV HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/apps/server/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "chown -R node:node \"$DATA_DIR\" && exec runuser -u node -- node dist/index.js"]
