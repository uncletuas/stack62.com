# Quick start

This walks through what a new user does in the first ten minutes
after signing up on Stack62.

## 1. Sign up

1. Open the Stack62 deployment URL.
2. Click **Get started → Set up Stack62 for my team**.
3. Fill in: your name, work email, role at the org (Founder, COO,
   etc.), org name, team size estimate.
4. Pick **Continue with Google** or set an email + password.

A **personal Coworker** is auto-created and linked to your account.
You don't manage multiple Coworkers — Stack62 deliberately runs one
per user, customisable in Settings → Coworker.

## 2. Find your way around

Left rail (top to bottom):

- **Systems** — apps the Coworker builds and runs for you.
- **Files** — your DMS. Folders, tile grid, semantic search.
- **Tasks** — work items assigned to you or the Coworker.
- **Schedules** — recurring or one-off jobs. The Coworker creates
  these for you when you say "remind me every weekday at 9".
- **Reports** — analytics from your systems.
- **Settings** (bottom).

Top bar:

- Centered **search** (`Cmd+K`) — works across everything.
- **Bell** — pending plan approvals + workflow approvals.
- **Avatar** (top right) — your profile, menus, sign out.

Right side: the **Coworker** floats. Click it to talk.

## 3. Try the Coworker

Click the floating face. The chat panel opens. Try:

- "Build me a CRM for tracking client follow-ups."
- "Find that document about Q3 onboarding."
- "Schedule a check-in every Monday at 9 AM."
- "Remember that our office hours are 9–5 ET."
- "Tell Sarah I'll be 10 minutes late."

### Voice conversation

In the composer, when the textbox is empty, the send button becomes
a mic icon. Tap it: the panel switches to voice mode. Speak — Stack62
recognises your words, sends them, and speaks the reply back. Tap
the red X to end.

### Live mode (camera + voice)

Tap the 🎥 in the panel header. The full-screen call view opens:
your camera fills the canvas, the Coworker face floats bottom-right.
Voice conversation auto-starts. Frames sample every 6 seconds so the
Coworker can see what's in front of you.

## 4. Connect integrations

**Settings → Integrations**. The relevant ones first time round:

- **Google Workspace** — Gmail / Calendar / Drive / Docs. Enables
  the `calendar.list_events` and `calendar.create_event` Coworker
  tools.
- **WhatsApp** — link a device so the Coworker can read and reply to
  customer messages from the chat area.
- **Resend** — outbound email. Required for the password-reset and
  email-verification flows.

## 5. Turn on autonomous mode

When you trust your Coworker enough, **Settings → Coworker → toggle
Autonomous mode**. From then on, schedules with `assignedToCoworker:
true` fire and the Coworker executes them on its own — up to action
level 2 (read/safe-write). Action level 3+ (external comms, money
movement) always pause for approval.

When autonomous mode is on, the floating Coworker face turns emerald
green and shows an **AUTO** badge.
