# Builds BOTH frontends and serves them behind a single Caddy, which also
# reverse-proxies /v1 to the API container. Build context is the repo root.
#   - Stack62_design  → customer app   → /srv          (stack62.loopital.com)
#   - admin-console   → ops console    → /srv-admin     (assembly.loopital.com)
# One Caddy serves both hostnames so they can share one EC2 instance's :443.

# ── Customer app ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY Stack62_design/package*.json ./
RUN npm install
COPY Stack62_design/ ./
# Absolute API base (same origin as the site → no CORS, no mixed content). The
# frontend's api client uses `new URL(base + path)`, which requires an absolute
# URL — a relative "/v1" throws. Override via the build arg for other domains.
ARG VITE_API_BASE_URL=https://stack62.loopital.com/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ── Admin / operations console ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS build-admin
WORKDIR /app
COPY admin-console/package*.json ./
RUN npm install
COPY admin-console/ ./
ARG VITE_ADMIN_API_BASE_URL=https://assembly.loopital.com/v1/admin
ENV VITE_ADMIN_API_BASE_URL=$VITE_ADMIN_API_BASE_URL
RUN npm run build

# ── Edge ────────────────────────────────────────────────────────────────────
FROM caddy:2-alpine
COPY deploy/aws/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
COPY --from=build-admin /app/dist /srv-admin
