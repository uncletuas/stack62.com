/**
 * Tiny HTTP client for the worker → API callback surface.
 * Authenticates with the session-scoped JWT the API minted at
 * schedule time. Each method maps to one /v1/meeting-bot/worker/...
 * route on the backend.
 */
export interface ApiClient {
  status(payload: {
    status:
      | "joining"
      | "in_meeting"
      | "summarising"
      | "completed"
      | "failed"
      | "cancelled";
    errorMessage?: string;
  }): Promise<void>;
  transcript(
    chunks: Array<{
      speakerLabel?: string;
      text: string;
      startsAtSec?: number;
    }>,
  ): Promise<void>;
  complete(): Promise<void>;
}

export function makeApiClient(
  apiBaseUrl: string,
  sessionId: string,
  workerToken: string,
): ApiClient {
  const base = `${apiBaseUrl.replace(/\/+$/, "")}/v1/meeting-bot/worker/${sessionId}`;
  const headers = {
    Authorization: `Bearer ${workerToken}`,
    "Content-Type": "application/json",
  } as const;
  return {
    async status(payload) {
      const res = await fetch(`${base}/status`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`status callback failed (${res.status}): ${await res.text().catch(() => "")}`);
      }
    },
    async transcript(chunks) {
      if (chunks.length === 0) return;
      const res = await fetch(`${base}/transcript`, {
        method: "POST",
        headers,
        body: JSON.stringify({ chunks }),
      });
      if (!res.ok) {
        // Non-fatal: a single failed batch shouldn't kill the bot.
        // eslint-disable-next-line no-console
        console.warn(
          `transcript callback failed (${res.status}): ${await res.text().catch(() => "")}`,
        );
      }
    },
    async complete() {
      const res = await fetch(`${base}/complete`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        throw new Error(
          `complete callback failed (${res.status}): ${await res.text().catch(() => "")}`,
        );
      }
    },
  };
}
