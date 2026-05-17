# Changelog

All notable changes to Stack62. Newest first. Dates in ISO 8601.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
with sections for **Added**, **Changed**, **Fixed**, **Removed**, and
**Security** as relevant.

## [Unreleased]

### Added
- Repository-level SDLC docs — `CONTRIBUTING.md`, `SECURITY.md`,
  `CHANGELOG.md`, `LICENSE`, PR + issue templates, ADR scaffold.
- Business material under `docs/business/` — executive summary,
  one-pager, pitch deck outline, business model, market analysis,
  competitive landscape, go-to-market, roadmap, KPIs, risk
  register, tech stack overview.

## [0.6.0] — 2026-05-16

### Added
- Coworker can now open files, folders, systems, tasks, schedules,
  plans, reports, workflows, meeting bot sessions, and rooms
  directly from the chat. New `workspace.open` engine tool returns
  an intent that the chat bubble renders as a clickable chip.
- Capabilities reference at `docs/SYSTEM_CAPABILITIES.md`.
- Settings: real Security section (change password, audit log
  download, 2FA placeholder), Notifications channel toggles,
  Billing org info. `POST /account/change-password` (authenticated)
  and `POST /account/resend-verification`.

### Changed
- Default Coworker face mood is `happy` (was `neutral`). The keyword
  mood classifier falls back to `happy` instead of `neutral`.
- Top-right profile button shows the uploaded avatar with a clean
  initials fallback.
- Chat panel tabs: **Team** is now a members directory (add /
  remove / DM), **Rooms** is now team channels + group rooms. 1:1
  DMs moved to Team.

### Fixed
- Realtime voice no longer goes silent after the first response.
  Server VAD now explicitly carries `create_response` /
  `interrupt_response`, and video frames are deferred while the
  model is mid-turn (frames sent during a turn were interrupting it).

## [0.5.0] — 2026-05-15

### Added
- Meeting bot speak-out (Phase 5). The Coworker can mute / unmute its
  bot user and speak responses into a live Google Meet via OpenAI TTS
  routed through a PulseAudio virtual sink into Chrome's mic input.
- Self-hosted LLM tier (Phase 7). `SELF_HOSTED_LLM_URL` env enables
  routing Tier-0/1 traffic to a self-hosted vLLM / TGI / Together
  endpoint instead of paying per-token to OpenRouter/Anthropic. See
  `docs/self-hosted-llm.md`.
- Drive-style files explorer: multi-select, bulk download / share /
  delete / move, F2 rename, Cut / Copy / Paste, right-click context
  menu, drag-onto-folder.
- In-app dialog system — `appDialog.alert/confirm/prompt`. Replaces
  all `window.alert/confirm/prompt` calls. Mounted at the workspace
  root via `<AppDialogHost />`.
- Meeting bot dashboard at workspace level.
- Integrations marketplace shows "not configured" badges for OAuth
  providers whose env vars aren't set, instead of failing on click.

### Changed
- File backend: rename + move + bulk endpoints on `/files`.

## [0.4.0] — 2026-05-13

### Added
- Realtime voice (Phase 1) — WebRTC bridge to OpenAI Realtime API.
- Realtime vision (Phase 2) — periodic camera frame capture sent
  over the same data channel.
- Meeting bot (Phase 3) — Google Meet attendance via Playwright +
  Chromium, caption scraping, summary generation. Worker deploys as
  a Render web service from `services/meeting-bot/`.

## [Earlier]

Pre-0.4 history is reconstructable from `git log` but not yet
hand-curated. Anything earlier than the realtime work was the core
engine + workspace plumbing — system builder, plans, runner,
integrations marketplace.
