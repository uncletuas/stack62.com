/**
 * Shared in-process registry mapping live sessionId → an interface
 * for poking the running Playwright session (e.g., to speak audio).
 *
 * Because both Workers live in the same Node process, the speak-queue
 * consumer can look up the session that runMeetingBot is currently
 * driving and trigger speech in its browser tab.
 */
export interface SpeakHandle {
  /** Play an mp3 buffer through the meeting bot's mic (virtual sink). */
  playAudio: (mp3: Buffer) => Promise<void>;
}

const handles = new Map<string, SpeakHandle>();

export function registerSession(sessionId: string, handle: SpeakHandle): void {
  handles.set(sessionId, handle);
}

export function unregisterSession(sessionId: string): void {
  handles.delete(sessionId);
}

export function getSession(sessionId: string): SpeakHandle | undefined {
  return handles.get(sessionId);
}
