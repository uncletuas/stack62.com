/**
 * Stack62 meeting-bot worker — BullMQ consumer.
 *
 * Listens on the `meeting-bot-sessions` queue. Each job carries a
 * sessionId, meetingUrl, displayName, and a short-lived JWT the
 * worker uses to authenticate when calling back to the API.
 *
 * Required env:
 *   REDIS_URL                 (same Redis the backend uses)
 *   MEETING_BOT_CONCURRENCY   (optional, default 1)
 *
 * The worker DOES NOT need a database URL — it never touches Postgres
 * directly. All persistence flows back through the API.
 */
import { Worker, type Job } from "bullmq";
import { makeApiClient } from "./api-client.js";
import { runMeetingBot } from "./meet-bot.js";
import { getSession } from "./session-registry.js";

interface JobData {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  meetingUrl: string;
  displayName: string;
  apiBaseUrl: string;
  workerToken: string;
}

interface SpeakJobData {
  sessionId: string;
  audioBase64: string;
  text: string;
}

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  // eslint-disable-next-line no-console
  console.error("REDIS_URL not set — meeting-bot worker cannot start.");
  process.exit(1);
}

const connection = parseRedisUrl(REDIS_URL);

const concurrency = Number(process.env.MEETING_BOT_CONCURRENCY || "1");

// eslint-disable-next-line no-console
console.log(
  `[meeting-bot] starting worker (concurrency=${concurrency}) → queue=meeting-bot-sessions`,
);

const worker = new Worker<JobData>(
  "meeting-bot-sessions",
  async (job: Job<JobData>) => {
    const data = job.data;
    // eslint-disable-next-line no-console
    console.log(
      `[meeting-bot] job ${job.id} session=${data.sessionId} url=${data.meetingUrl}`,
    );
    const api = makeApiClient(data.apiBaseUrl, data.sessionId, data.workerToken);
    try {
      await runMeetingBot(data.meetingUrl, data.displayName, api, data.sessionId);
      // eslint-disable-next-line no-console
      console.log(`[meeting-bot] job ${job.id} completed.`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[meeting-bot] job ${job.id} failed:`, err);
      throw err;
    }
  },
  {
    connection,
    concurrency,
    autorun: true,
  },
);

worker.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log("[meeting-bot] connected to Redis, waiting for jobs.");
});

worker.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[meeting-bot] worker error:", err);
});

// ── Speak-out worker ───────────────────────────────────────────────
// Separate queue so an active attend job (which sits in-meeting for
// the whole call) doesn't block speak jobs targeted at it.
const speakWorker = new Worker<SpeakJobData>(
  "meeting-bot-speak",
  async (job: Job<SpeakJobData>) => {
    const handle = getSession(job.data.sessionId);
    if (!handle) {
      // eslint-disable-next-line no-console
      console.warn(
        `[meeting-bot] speak job ${job.id} dropped: session ${job.data.sessionId} not active on this worker.`,
      );
      return;
    }
    const mp3 = Buffer.from(job.data.audioBase64, "base64");
    await handle.playAudio(mp3);
  },
  { connection, concurrency: 1, autorun: true },
);
speakWorker.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[meeting-bot] speak worker error:", err);
});

// Graceful shutdown so in-flight Meet sessions get a chance to leave
// the call cleanly.
const shutdown = async () => {
  // eslint-disable-next-line no-console
  console.log("[meeting-bot] shutting down…");
  await worker.close();
  await speakWorker.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: object;
} {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || (u.protocol === "rediss:" ? 6380 : 6379)),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
