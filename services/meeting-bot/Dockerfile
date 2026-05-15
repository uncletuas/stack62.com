# ── Stack62 meeting-bot worker image ─────────────────────────────────
# Base: Playwright's Ubuntu image ships Chromium + all the X11/audio
# system deps the browser needs. About 1.5 GB on disk but it's the
# painless path — installing Chromium dependencies into a slim Node
# image takes 40+ lines of apt-get incantations.
# ──────────────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Speak-out (Phase 5) needs pulseaudio (virtual sink + paplay) and
# ffmpeg (mp3 → wav). The Playwright base has neither.
RUN apt-get update \
  && apt-get install -y --no-install-recommends pulseaudio pulseaudio-utils ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install deps first so layer caching works on subsequent rebuilds.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy + compile.
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# Startup script that boots PulseAudio + the virtual sink, then exec's
# the node worker. Lives at /app/entrypoint.sh.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENV MEETING_BOT_CONCURRENCY=1
ENV MEETING_BOT_VIRTUAL_SINK=virtual_speaker

# No port exposed — workers are queue consumers, not HTTP servers.
CMD ["/app/entrypoint.sh"]
