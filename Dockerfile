# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN npm install -g pnpm@9.5.0
WORKDIR /app

# ── deps: install all workspace deps ─────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ── build-api: copy source for api + worker (no compile step, tsx runs TS) ───
FROM deps AS build-api
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# ── build-web: compile Vite React app ────────────────────────────────────────
FROM deps AS build-web
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @sms/web build

# ── api runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS api
RUN npm install -g pnpm@9.5.0
WORKDIR /app
COPY --from=build-api /app .
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "--import", "tsx/esm", "src/server.ts"]

# ── worker runtime ────────────────────────────────────────────────────────────
FROM node:22-alpine AS worker
RUN npm install -g pnpm@9.5.0
WORKDIR /app
COPY --from=build-api /app .
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx/esm", "src/worker.ts"]

# ── migrate runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS migrate
RUN npm install -g pnpm@9.5.0
WORKDIR /app
COPY --from=build-api /app .
WORKDIR /app/apps/api
CMD ["pnpm", "db:migrate"]

# ── web: nginx serving built Vite dist ────────────────────────────────────────
FROM nginx:alpine AS web
COPY --from=build-web /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
