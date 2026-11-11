# syntax=docker/dockerfile:1
# One image serves everything: the API, the chat widget (brewbot.js + demo page) and the
# analytics dashboard (/admin). Configuration comes from environment variables at runtime.

# ---- 1. Build the two React front ends --------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
# Manifests first, so the npm install layer is cached until dependencies change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/widget/package.json apps/widget/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
# Vite reads the apps' tsconfig, which extends the shared base config.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/widget apps/widget
COPY apps/dashboard apps/dashboard
RUN npm run build -w @brewbot/widget && npm run build -w @brewbot/dashboard

# ---- 2. Production dependencies of the API only ------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/widget/package.json apps/widget/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --no-audit --no-fund -w @brewbot/api \
 && mkdir -p apps/api/node_modules

# ---- 3. Runtime ----------------------------------------------------------------------------
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/
COPY apps/api/db apps/api/db
COPY apps/api/src apps/api/src
# The knowledge base, so "node src/scripts/ingest.ts" can be run from the image.
COPY data data
COPY --from=build /app/apps/widget/dist apps/widget/dist
COPY --from=build /app/apps/dashboard/dist apps/dashboard/dist

USER node
WORKDIR /app/apps/api
EXPOSE 8080
# Node 22.18+ runs TypeScript directly by stripping the types: no tsx or build step at runtime.
CMD ["node", "src/server.ts"]
