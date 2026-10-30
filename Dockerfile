# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# ---- Stage 1: build the web app (vite build -> dist/) ----
FROM node:${NODE_VERSION}-bookworm-slim AS web-build

# Toolchain for better-sqlite3's node-gyp path when no prebuild matches this
# Node ABI; harmless when a prebuilt binary downloads instead.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: run Express serving dist/ + API ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Production dependency tree only (tsx now lives in "dependencies" because
# server:start runs on it).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=web-build /app/dist ./dist
COPY server ./server

# SQLite + media home for the saved-projects feature; volume-mounted by
# docker-compose.yml. Owned by the non-root runtime user.
RUN mkdir -p /app/data && chown node:node /app/data

# Healthcheck hits the scaffold endpoint from the Express server PR.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENV PORT=3001
EXPOSE 3001

USER node
# Direct exec (not `npm run`) so SIGTERM reaches the server immediately.
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
