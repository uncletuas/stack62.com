#!/usr/bin/env bash
# Boot a per-container PulseAudio daemon with a virtual sink that
# Chrome will consume as its "microphone" via the fake-audio-capture
# flag. Then hand off to the Node worker.
set -euo pipefail

SINK_NAME="${MEETING_BOT_VIRTUAL_SINK:-virtual_speaker}"

# Run pulseaudio in the background, system-wide so the worker process
# (any uid) can talk to it. --exit-idle-time=-1 keeps it alive even
# when no client is connected.
pulseaudio --start --exit-idle-time=-1 --disallow-exit --log-target=stderr || true

# Create a null sink whose monitor we'll feed to Chrome's mic. If a
# sink with that name already exists (warm restart in dev), pactl will
# fail — that's fine, we ignore.
pactl load-module module-null-sink sink_name="${SINK_NAME}" sink_properties=device.description="VirtualSpeaker" || true

# Make the monitor of the null sink the default *source* so any
# process that grabs "default" mic input gets our TTS audio.
pactl set-default-source "${SINK_NAME}.monitor" || true

# Provide a silent wav file so Chrome's --use-file-for-fake-audio-
# capture flag has something to read pre-speak. (paplay also feeds
# the same sink during speak.) 1 second of silence at 48 kHz mono.
ffmpeg -y -f lavfi -i anullsrc=channel_layout=mono:sample_rate=48000 \
  -t 1 /tmp/meeting-bot-mic.wav > /dev/null 2>&1 || true

echo "[entrypoint] pulseaudio ready, sink=${SINK_NAME}, starting node worker."
exec node --enable-source-maps dist/index.js
