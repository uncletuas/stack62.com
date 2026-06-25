# ── Stack62 production image ────────────────────────────────────────────
# Multi-stage Docker build. The same image runs either the API or the
# worker, selected at runtime by the start command. Render's blueprint
# (render.yaml) overrides `dockerCommand` per service to pick which one.
# ───────────────────────────────────────────────────────────────────────

FROM node:20-slim AS deps
WORKDIR /usr/src/app
COPY package*.json ./
# Install all deps (incl. dev) so we can run `nest build` in the next stage.
RUN npm ci --include=dev

FROM node:20-slim AS builder
WORKDIR /usr/src/app
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
# Render exposes PORT to the container; main.ts honours it. We also
# expose 3000 here for local docker run / docker-compose parity.
ENV PORT=3000

# Production deps only.
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# In-app web browser: install Chromium + its system libraries so Playwright
# can launch a headless browser at runtime. Adds ~300MB to the image and the
# service needs >=512MB RAM. Set BROWSER_ENABLED=false to skip using it.
RUN npx playwright install --with-deps chromium

# Compiled JS + migrations + the few static configs we need at runtime.
COPY --from=builder /usr/src/app/dist ./dist

# Persistent storage targets — the render.yaml mounts a volume here.
RUN mkdir -p /var/data/files /var/data/documents /var/data/generated

EXPOSE 3000

# Default to running the API. The worker service overrides this with
# `node dist/worker.js` via render.yaml's `dockerCommand`.
CMD ["node", "dist/main.js"]
