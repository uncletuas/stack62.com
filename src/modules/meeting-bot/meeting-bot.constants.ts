export const MEETING_BOT_QUEUE = 'meeting-bot-sessions';
export const MEETING_BOT_SPEAK_QUEUE = 'meeting-bot-speak';

export interface MeetingBotJobData {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  meetingUrl: string;
  displayName: string;
  // The worker reports back via REST; this gives it the API base.
  apiBaseUrl: string;
  // A short-lived worker token signed with the JWT secret so the
  // worker can authenticate when it posts back transcript chunks.
  workerToken: string;
}

/**
 * Speak-out job. Lives on a separate queue so the worker can pick
 * it up while the long-running attend-session job still holds the
 * main queue's concurrency slot.
 *
 * `audioBase64` is the TTS body (mp3, mono). The worker decodes,
 * pipes through PulseAudio's virtual sink, and Chrome captures it
 * as the mic input. Small enough (~25 KB / sentence) to ship via
 * Redis without storage indirection.
 */
export interface MeetingBotSpeakJobData {
  sessionId: string;
  /** mp3 body, base64-encoded. */
  audioBase64: string;
  /** Whatever the model said, for the activity log + transcript echo. */
  text: string;
}
