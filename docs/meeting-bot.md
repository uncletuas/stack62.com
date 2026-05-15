# Meeting Bot — architecture & rollout plan

The Coworker joins a **Google Meet** link as "Stack62 Coworker",
transcribes the audio, takes notes, and posts a summary to the user's
Coworker room when the call ends. Optional follow-on: speak responses
back into the meeting when the Coworker has something to contribute.

This isn't shipped yet — it's a significant infra change. This doc
captures the design so we can ship it cleanly when the user is ready.

**Scope decision (current)**: Google Meet only. Zoom and Teams are
deferred — Zoom needs the heavyweight Meeting SDK + a separate
developer account, Teams adds another protocol surface. Meet via
Playwright is the cheapest path to "Coworker attends meetings" and
covers the majority of Stack62's expected users on its own.

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
    join flow lives in `provider/google-meet.ts`. Zoom / Teams are
    not in scope for v1.
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
  the user says "join my 3 PM Meet and take notes".
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
| Google Meet behavior | Guest-join works without an SDK; Playwright drives the join, mic-muted, audio-only listen. Corporate-firewalled meets that block guests will fail — we surface the join error to the user instead of pretending it worked. |
| Risk | TOS — each platform's anti-bot detection. Display name and audio-only join keeps it well clear of automated-detection heuristics, but a corp-firewalled Meet may block the join. We handle the failure gracefully and notify the user. |

## Rollout

1. **MVP**: Google Meet only. Audio-only listen. Streaming STT →
   live transcript stored in `meeting_transcripts`. Claude
   end-of-call summary posted to the user's Coworker room with the
   action items pulled out as Stack62 tasks.
2. **+1 week**: Speaker diarization (Deepgram diarization or pyannote)
   so the transcript labels who said what.
3. **+1 week**: Coworker speaks back into the meeting — TTS routed
   to the headless Chrome's virtual mic so the bot can contribute
   when the user @-mentions "Stack62" in the meeting chat or when
   the engine decides it has something useful to add.

Estimated effort end-to-end: **4–6 days of focused work** for the
MVP, dominated by Playwright Meet-join flow + audio capture plumbing.
