import { chromium, type Page } from "playwright";
import type { ApiClient } from "./api-client.js";

/**
 * Drives a single Google Meet attendance session.
 *
 * Flow:
 *   1. Launch headless Chromium with mic + cam permissions granted up-
 *      front (fake-ui-for-media-stream so no prompt blocks the join).
 *   2. Navigate to the Meet URL.
 *   3. Fill in the "Your name" field with the bot display name.
 *   4. Turn the mic + camera OFF before joining (we don't broadcast).
 *   5. Click "Ask to join" (or "Join now" depending on the URL flavour).
 *   6. Once in the call, enable captions and poll the caption DOM
 *      every 1.5s, batching new lines into 5-second transcript pushes.
 *   7. When the call ends (page redirects to leave/exit URL or the
 *      Meet UI shows "You left the meeting"), call complete().
 *
 * Honest scope: caption-based transcription works whenever Meet's
 * own captions work. Hosts can disable captions org-wide, in which
 * case we capture nothing and the session resolves with an empty-
 * summary message. Audio-capture-based transcription via Whisper /
 * Deepgram is a follow-up.
 */
export async function runMeetingBot(
  meetingUrl: string,
  displayName: string,
  api: ApiClient,
): Promise<void> {
  // Mark "joining" the moment the job is picked up.
  await api.status({ status: "joining" });

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const startedAt = Date.now();

  try {
    const context = await browser.newContext({
      // Granting permissions up front avoids the join-time prompt.
      permissions: ["camera", "microphone"],
      // A real Chrome UA so Meet doesn't downgrade to the no-JS path.
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);

    await page.goto(meetingUrl, { waitUntil: "domcontentloaded" });

    // Pre-join page: fill name, turn off mic + cam.
    await page.waitForLoadState("networkidle").catch(() => undefined);

    // The "Your name" input only appears for guests not signed into a
    // Google account. We try common selectors and skip if not present.
    const nameInput = page
      .locator(
        'input[aria-label*="name" i], input[placeholder*="name" i]',
      )
      .first();
    if (await nameInput.count().then((n) => n > 0)) {
      try {
        await nameInput.fill(displayName);
      } catch {
        /* harmless if input is read-only on this Meet variant */
      }
    }

    // Pre-mute mic + cam if the buttons are present and currently on.
    await clickIfMatches(page, [
      'button[aria-label*="microphone" i][aria-pressed="false"]',
      'button[aria-label*="Turn off microphone" i]',
    ]);
    await clickIfMatches(page, [
      'button[aria-label*="camera" i][aria-pressed="false"]',
      'button[aria-label*="Turn off camera" i]',
    ]);

    // Click "Join now" / "Ask to join".
    const joinButton = page
      .locator(
        'button:has-text("Ask to join"), button:has-text("Join now")',
      )
      .first();
    if ((await joinButton.count()) === 0) {
      throw new Error("Couldn't find a Join button on this Meet URL.");
    }
    await joinButton.click();

    // Wait until we're past the lobby. The hangup button is the most
    // reliable signal that we're inside the call.
    await page
      .locator(
        'button[aria-label*="Leave call" i], button[aria-label*="Leave the call" i]',
      )
      .first()
      .waitFor({ state: "visible", timeout: 90_000 });

    await api.status({ status: "in_meeting" });

    // Enable captions. Meet's keyboard shortcut is "C"; we also try
    // the menu button as a fallback. Captions are off by default for
    // most accounts.
    await page.keyboard.press("c").catch(() => undefined);
    await page.waitForTimeout(800);

    // Caption scraping loop.
    await scrapeCaptions(page, api, startedAt);

    await api.status({ status: "completed" }).catch(() => undefined);
    await api.complete();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await api
      .status({ status: "failed", errorMessage: message })
      .catch(() => undefined);
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Click the first selector that matches an element actually on the
 *  page. Swallows misses — these are all best-effort pre-join clicks. */
async function clickIfMatches(page: Page, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if ((await el.count().catch(() => 0)) > 0) {
      await el.click().catch(() => undefined);
      return;
    }
  }
}

/**
 * Polls the captions container, batches new lines, pushes them to the
 * API. Exits when the Meet UI redirects to the leave page or the
 * hangup button disappears (i.e. the host ended the call or we got
 * removed).
 */
async function scrapeCaptions(
  page: Page,
  api: ApiClient,
  startedAt: number,
): Promise<void> {
  // Meet renders each caption line as a div with role="region" and
  // an aria-label containing "Captions". The structure changes across
  // releases; we use a broad selector and dedupe in memory.
  const seen = new Set<string>();
  let pending: Array<{ speakerLabel?: string; text: string; startsAtSec: number }> = [];
  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    await api.transcript(batch);
  };
  const flushInterval = setInterval(() => {
    flush().catch(() => undefined);
  }, 5000);

  try {
    // The call is over when the hangup control disappears.
    const hangup = page
      .locator(
        'button[aria-label*="Leave call" i], button[aria-label*="Leave the call" i]',
      )
      .first();

    while (true) {
      const stillIn = await hangup.count().then((n) => n > 0).catch(() => false);
      if (!stillIn) break;

      // Pull the current state of the caption container.
      const lines = await page
        .evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const root = document.querySelector<HTMLElement>(
            '[aria-label*="Captions" i], [data-allocation-index]',
          );
          if (!root) return [] as Array<{ speaker?: string; text: string }>;
          // Each speaker block is usually a child div with two children:
          // a small avatar/name + the spoken text. We scrape both.
          const blocks = Array.from(
            root.querySelectorAll<HTMLElement>("[jsname], [data-tooltip]"),
          );
          const out: Array<{ speaker?: string; text: string }> = [];
          for (const block of blocks) {
            const speaker =
              block
                .querySelector(".KcIKyf, .zs7s8d")
                ?.textContent?.trim() || undefined;
            const text = block
              .querySelector(".iTTPOb, .CNusmb, [data-self-name]")
              ?.textContent?.trim();
            if (text) out.push({ speaker, text });
          }
          return out;
        })
        .catch(() => [] as Array<{ speaker?: string; text: string }>);

      for (const line of lines) {
        // Dedup key — speaker + text. Captions get appended and
        // mutated mid-utterance; we accept the latest form of each
        // unique line.
        const key = `${line.speaker ?? ""}::${line.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pending.push({
          speakerLabel: line.speaker,
          text: line.text,
          startsAtSec: Math.round((Date.now() - startedAt) / 1000),
        });
      }

      await page.waitForTimeout(1500);
    }
  } finally {
    clearInterval(flushInterval);
    await flush();
  }
}
