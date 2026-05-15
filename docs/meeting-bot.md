# Meeting Bot — architecture & rollout plan

The Coworker joins a Zoom / Google Meet / Microsoft Teams link as
"Stack62 Coworker", transcribes the audio, takes notes, and posts a
summary to the user's Coworker room when the call ends.

This isn't shipped yet — it's a significant infra change. This doc
captures the design so we can ship it cleanly when the user is ready.

## High-level design

```
 ┌────────────────────┐  webhook  ┌──────────────────────┐
 │  Coworker chat /   │ ──── ▶   │  POST /v1/meeting-bot │
 │  Schedules UI      │           │  /sessions           │
 └────────────────────┘           └──────────┬───────────┘
                                              │ enqueue
                                              ▼
                                  ┌──────────────────────┐
                                  │  meeting-bot worker  │
                                  │  (Render Worker)     │
                                  │                      │
                                  │  - Puppeteer / Playwright
                                  │  - Joins URL          │
                                  │  - Captures audio    │
                                  │  - Streams to Whisper│
                                  │  - Writes transcript │
                                  └──────────┬───────────┘
                                              │ on end
                                              ▼
                                  ┌──────────────────────┐
                                  │  Summariser           │
                                  │  - Anthropic claude  │
                                  │  - Outputs:           │
                                  │    • summary         │
                                  │    • action items    │
                                  │    • decisions       │
                                  └──────────┬───────────┘
                                              │ post
                                              ▼
                                  ┌──────────────────────┐
                                  │  Coworker room        │
                                  │  attached file        │
                                  │  notification         │
                                  └──────────────────────┘
```

## Pieces to build

### 1. Meeting bot worker (separate Render service)

- New service type: `worker` on Render, runs a Node + headless Chrome
  container.
- Listens on a BullMQ queue named `meeting-bot-sessions`.
- For each job:
  - Spawns Chromium (Playwright preferred over Puppeteer for the
    audio-capture extension support).
  - Navigates to the meeting URL.
  - Joins as a guest with name "Stack62 Coworker" — provider-specific
    join flows handled in `provider/zoom.ts`, `provider/google-meet.ts`,
    `provider/teams.ts`.
  - Captures the call audio via the WebRTC MediaStream Capture API or
    a Chromium extension (`chrome.tabCapture` for tab audio).
  - Pipes audio chunks (16 kHz mono) into Whisper via the OpenAI
    Whisper streaming API (separate from Realtime — same OPENAI_API_KEY
    works for both).
  - Persists rolling transcript + speaker labels.

### 2. Stack62 backend

- New entities:
  - `MeetingBotSession` { id, organizationId, workspaceId, meetingUrl,
    provider, status, transcriptFileId, summaryRoomMessageId,
    startedAt, endedAt }.
  - `MeetingBotTranscript` { id, sessionId, ordinal, speakerLabel,
    text, startsAtSec, endsAtSec }.
- New endpoints (auth required):
  - `POST /v1/meeting-bot/sessions` — schedule the bot to join a URL.
  - `GET /v1/meeting-bot/sessions/:id` — status + transcript.
  - `POST /v1/meeting-bot/sessions/:id/cancel` — abort.
- BullMQ queue producer in `MeetingBotService.scheduleSession()`.

### 3. Coworker tool

- `meetings.attend` — high-level wrapper: takes a meeting URL,
  optionally a Coworker room id to post the summary to, schedules
  the session, returns the session id. The Coworker calls this when
  the user says "join my 3 PM Zoom and take notes".
- `meetings.summary` — fetch the latest finished session's summary.

### 4. Summariser

- Runs at meeting end. Uses Claude Sonnet via the existing engine.
  Prompt template covers: overall summary (200 words), decisions,
  action items (with assignee + due date when stated), open questions.
- Output goes to:
  - A new docx file (uploaded to FilesService).
  - A message in the Coworker room with the summary inline + the
    file attachment.

## What's needed to ship

| | |
|---|---|
| New Render service | A worker with Docker, ~512 MB RAM, ~$7/mo |
| Container image | `mcr.microsoft.com/playwright:focal` (~600 MB) + our code |
| Env vars | `OPENAI_API_KEY` for Whisper; `MEETING_BOT_DISPLAY_NAME` (default "Stack62 Coworker") |
| Meet/Zoom/Teams behavior | Each platform has guest-join quirks; the v1 ships Google Meet first (cleanest API), then Zoom (more friction), then Teams |
| Risk | TOS — each platform's anti-bot detection. Display name and audio-only join keeps it well clear of automated-detection heuristics, but a corp-firewalled Meet may block the join. We handle the failure gracefully and notify the user. |

## Risk-mitigated rollout

1. **MVP**: Google Meet only. Audio-only. Transcript + summary.
2. **+1 week**: Zoom. Same flow with provider-specific join.
3. **+2 weeks**: Teams + speaker diarization (separate speaker tracks).
4. **+3 weeks**: Action-item extraction → auto-create tasks for assignees.

Estimated effort end-to-end: **5–8 days of focused work**, dominated
by Playwright join flows and audio capture plumbing.
