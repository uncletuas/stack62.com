export const MEETING_BOT_QUEUE = 'meeting-bot-sessions';

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
