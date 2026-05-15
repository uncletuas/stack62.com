# ── Stack62 meeting-bot worker image ─────────────────────────────────
# Base: Playwright's Ubuntu image ships Chromium + all the X11/audio
# system deps the browser needs. About 1.5 GB on disk but it's the
# painless path — installing Chromium dependencies into a slim Node
# image takes 40+ lines of apt-get incantations.
# ──────────────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Install deps first so layer caching works on subsequent rebuilds.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy + compile.
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

ENV NODE_ENV=production
ENV MEETING_BOT_CONCURRENCY=1

# No port exposed — workers are queue consumers, not HTTP servers.
CMD ["node", "--enable-source-maps", "dist/index.js"]
