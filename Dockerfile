# syntax=docker/dockerfile:1.7
# ─── FlowMind single-service image ───────────────────────────────────────────
# Builds the React frontend + the Express API bundle, then serves both from
# one Node process. The frontend dist is copied next to the api bundle so
# app.ts can express.static() it.
# =============================================================================

ARG NODE_VERSION=24-alpine

# ─── builder ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# Native build deps for bcrypt + other binary modules
RUN apk add --no-cache python3 make g++ libc6-compat

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy lockfile + manifests first so layer cache survives source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json tsconfig.base.json tsconfig.json ./
COPY artifacts/api-server/package.json     artifacts/api-server/
COPY artifacts/flowmind/package.json       artifacts/flowmind/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY lib/api-spec/package.json             lib/api-spec/
COPY lib/api-zod/package.json              lib/api-zod/
COPY lib/api-client-react/package.json     lib/api-client-react/
COPY lib/db/package.json                   lib/db/
COPY lib/integrations-openai-ai-react/package.json   lib/integrations-openai-ai-react/
COPY lib/integrations-openai-ai-server/package.json  lib/integrations-openai-ai-server/
COPY lib/integrations/openai_ai_integrations/        lib/integrations/openai_ai_integrations/
COPY scripts/package.json scripts/

RUN pnpm install --frozen-lockfile

# Bring the rest of the source in and build
COPY . .

# Typecheck libs + build api-server (esbuild bundle) + frontend (vite build)
RUN pnpm run build

# Stage the runtime artifacts in one place so the final image stays small
RUN mkdir -p /out/dist \
 && cp -r artifacts/api-server/dist/. /out/dist/ \
 && cp -r artifacts/flowmind/dist/public /out/dist/public

# ─── runner ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# bcrypt is externalised by esbuild — its native .node file is the only
# runtime dep that lives outside the bundled dist/index.mjs. We install just
# bcrypt directly (no monorepo, no pnpm in the runner) for a tiny image.
RUN apk add --no-cache libc6-compat \
 && apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --omit=dev --no-package-lock bcrypt@6 nodemailer@8 \
 && apk del .build-deps

ENV NODE_ENV=production
ENV PUBLIC_DIR=/app/dist/public

# Copy the bundled API + static frontend
COPY --from=builder /out/dist ./dist

EXPOSE 8080
# PORT is injected by Railway; HOST defaults to 0.0.0.0 in index.ts
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
