# Stack62 meeting-bot worker

Joins Google Meet links via Playwright + headless Chromium, scrapes
Meet's live captions, ships the transcript to the Stack62 API. Runs
as a separate Render service so the main API container doesn't carry
Chromium.

## Architecture

```
  Stack62 API (Render web)                  ┌── meeting-bot worker (Render worker, this dir)
       │                                    │
       │  POST /v1/meeting-bot/sessions     │
       │  (user / Coworker triggers)        │
       │ ───────► BullMQ queue ────────────►│
       │                                    │   Playwright + Chromium
       │                                    │   joins Meet URL
       │                                    │   scrapes captions every 1.5s
       │                                    │   batches every 5s
       │ ◄── POST /v1/meeting-bot/worker/:id/transcript
       │                                    │
       │ ◄── POST /v1/meeting-bot/worker/:id/complete
       │      (kicks Claude summary)        │
       │                                    │
       │  Summary + transcript visible      │
       │  in the user's session detail.     │
```

## Required environment

| Env var | Required | What |
|---|---|---|
| `REDIS_URL` | yes | Same Redis the backend uses — that's how the worker pulls queued sessions. On Render, link this from the same Key-Value service the API uses. |
| `MEETING_BOT_CONCURRENCY` | no | Default 1. Each concurrent Meet instance needs ~500 MB RAM + a Chromium process. Don't push this above 2 on a free-tier Render worker. |

The worker DOES NOT need `DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY`, or any of the LLM keys — it never touches the database and the summariser runs on the API side. Worker auth to the API is via the session-scoped JWT the API mints at schedule time and embeds in the job payload.

## Deploying on Render

1. Push this repo to GitHub (already done — `uncletuas/stack62.com`).
2. In Render: **New → Web Service → Docker**. Even though this is a
   worker, Render's "Web Service" type with no health-check path
   works; the alternative "Background Worker" is fine too, the
   semantics are the same here since we don't expose ports.
3. Repo: `uncletuas/stack62.com`. Branch: `main`. **Dockerfile path:
   `services/meeting-bot/Dockerfile`**. Build context: `services/meeting-bot`.
4. Plan: **Starter** (512 MB RAM minimum — Chromium will OOM on free
   tier with even one concurrent Meet).
5. Env vars: link `REDIS_URL` from the existing `stack62-redis`
   service. Optionally set `MEETING_BOT_CONCURRENCY=1`.
6. **Don't set any other env**. Especially don't paste your
   `OPENROUTER_API_KEY` here — it's not needed and creates blast
   radius if the worker is compromised.
7. Save + deploy. Watch the build logs for the Playwright base image
   pull (~1.5 GB, takes 3-5 minutes the first time).
8. Once "Live", trigger a test by hitting:
   ```
   POST https://stack62-api.onrender.com/v1/meeting-bot/sessions
   Authorization: Bearer <your JWT>
   { "organizationId": "...", "workspaceId": "...", "meetingUrl": "https://meet.google.com/abc-defg-hij" }
   ```
   Or just say to the Coworker: **"Attend this meeting: <Meet URL>"**.

## Limits + known issues

- **Captions only.** This MVP scrapes Meet's UI captions instead of
  capturing audio. If the host has captions disabled org-wide,
  we capture nothing and the summary says so. Audio capture →
  Whisper / Deepgram is the planned next iteration.
- **Guest join only.** The bot doesn't sign into a Google account.
  Meets that require organizational sign-in to join will fail at the
  "you need to be signed in" step. We surface that error to the user.
- **Anti-bot detection.** We pass through `--disable-blink-features=
  AutomationControlled` + a real Chrome user-agent. Most Meet hosts
  won't notice; aggressive corp Meet setups might. We don't try to
  defeat detection beyond standard hygiene.
- **No mic / cam broadcast.** The bot joins muted with camera off.
  Speaking back into the meeting (Phase 5 — TTS through a virtual
  mic) is a follow-up.
