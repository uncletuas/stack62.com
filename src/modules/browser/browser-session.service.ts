import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { Browser, BrowserContext, Page } from 'playwright';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; url: string }>;
}

export interface PageState {
  url: string;
  title: string;
}

export type BrowserAction =
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; deltaY: number }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' };

interface Session {
  context: BrowserContext;
  page: Page;
  lastUsed: number;
}

/**
 * A search engine is a results-URL builder, a selector to wait for, and a DOM
 * parser that runs in the page. Add engines (Brave, Google CSE, …) by extending
 * this map — the rest of the browser is engine-agnostic.
 *
 * Note: DuckDuckGo aggressively blocks automated browsers (its html/ and lite/
 * endpoints serve an anomaly/CAPTCHA page to headless Chromium), so its parsed
 * result list is best-effort — the rendered page still loads for the user to
 * click. Bing renders and parses reliably, so it is the default for structured
 * results (and what the coworker's web.search depends on).
 */
interface EngineDef {
  buildUrl: (query: string) => string;
  /** Selector that indicates results have rendered; awaited before parsing. */
  waitFor?: string;
  parse: () => SearchResult[]; // runs inside page.evaluate (browser context)
}

const ENGINES: Record<string, EngineDef> = {
  bing: {
    buildUrl: (q) =>
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`,
    waitFor: 'li.b_algo',
    parse: () => {
      const out: Array<{ title: string; url: string; snippet: string }> = [];
      document.querySelectorAll('li.b_algo').forEach((li) => {
        const link = li.querySelector<HTMLAnchorElement>('h2 a');
        if (!link?.href) return;
        const snippet =
          li.querySelector('.b_caption p')?.textContent?.trim() ??
          li.querySelector('p')?.textContent?.trim() ??
          '';
        out.push({
          title: link.textContent?.trim() ?? '',
          url: link.href,
          snippet,
        });
      });
      return out.slice(0, 15);
    },
  },
  duckduckgo: {
    // Normal (JS-rendered) page renders results for the user without a CAPTCHA.
    buildUrl: (q) =>
      `https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web`,
    waitFor: 'article[data-testid="result"], ol.react-results--main li',
    parse: () => {
      const out: Array<{ title: string; url: string; snippet: string }> = [];
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a[data-testid="result-title-a"], article a[href^="http"]',
        ),
      );
      const seen = new Set<string>();
      for (const link of anchors) {
        if (!link.href || seen.has(link.href)) continue;
        const text = link.textContent?.trim() ?? '';
        if (!text) continue;
        seen.add(link.href);
        out.push({ title: text, url: link.href, snippet: '' });
        if (out.length >= 15) break;
      }
      return out;
    },
  },
};

/**
 * Owns a single shared headless Chromium and a pool of browsing sessions
 * keyed by `${organizationId}:${workspaceId}`. Both the human BrowserEditor
 * and the coworker's web.* tools drive the *same* session for a workspace —
 * that is what lets the coworker open/read/navigate exactly what the user
 * sees, and vice-versa.
 */
@Injectable()
export class BrowserSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserSessionService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly sessions = new Map<string, Session>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  // ── Public capability flag ───────────────────────────────────────

  isEnabled(): boolean {
    return this.config.get<boolean>('BROWSER_ENABLED') !== false;
  }

  private assertEnabled() {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'The in-app browser is disabled on this deployment.',
      );
    }
  }

  // ── Session lifecycle ────────────────────────────────────────────

  sessionKey(organizationId: string, workspaceId?: string | null): string {
    return `${organizationId}:${workspaceId ?? 'default'}`;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      // Imported lazily so the dependency only loads when browsing is used
      // (and so boot never fails if the Chromium binary isn't installed).
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      this.browser = browser;
      browser.on('disconnected', () => {
        this.browser = null;
        this.sessions.clear();
      });
      this.startSweeper();
      return browser;
    })();
    try {
      return await this.launching;
    } catch (err) {
      this.logger.error(
        `Failed to launch Chromium: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException(
        'Browser engine is unavailable. Chromium may not be installed.',
      );
    } finally {
      this.launching = null;
    }
  }

  private async ensure(key: string): Promise<Session> {
    const existing = this.sessions.get(key);
    if (existing && !existing.page.isClosed()) {
      existing.lastUsed = Date.now();
      return existing;
    }
    this.assertEnabled();
    const max = this.config.get<number>('BROWSER_MAX_SESSIONS') ?? 10;
    if (this.sessions.size >= max) {
      // Evict the least-recently-used session to stay within budget.
      const lru = [...this.sessions.entries()].sort(
        (a, b) => a[1].lastUsed - b[1].lastUsed,
      )[0];
      if (lru) await this.close(lru[0]);
    }
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: {
        width: this.config.get<number>('BROWSER_VIEWPORT_WIDTH') ?? 1280,
        height: this.config.get<number>('BROWSER_VIEWPORT_HEIGHT') ?? 800,
      },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    context.setDefaultNavigationTimeout(
      this.config.get<number>('BROWSER_NAV_TIMEOUT_MS') ?? 30000,
    );
    const page = await context.newPage();
    const session: Session = { context, page, lastUsed: Date.now() };
    this.sessions.set(key, session);
    return session;
  }

  private async close(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    await session.context.close().catch(() => undefined);
  }

  private startSweeper() {
    if (this.sweeper) return;
    const idleMs = this.config.get<number>('BROWSER_SESSION_IDLE_MS') ?? 300000;
    this.sweeper = setInterval(
      () => {
        const now = Date.now();
        for (const [key, session] of this.sessions) {
          if (now - session.lastUsed > idleMs) {
            void this.close(key);
          }
        }
      },
      Math.max(30000, Math.floor(idleMs / 2)),
    );
    // Don't keep the process alive just for the sweeper.
    this.sweeper.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
    for (const key of [...this.sessions.keys()]) {
      await this.close(key);
    }
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  // ── SSRF guard ───────────────────────────────────────────────────

  /**
   * Reject anything that isn't a public http(s) URL: no file://, no
   * localhost, no private/loopback/link-local ranges, no cloud metadata.
   * Resolves DNS so a hostname pointing at an internal IP is also caught.
   */
  private async assertSafeUrl(raw: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException(`Invalid URL: ${raw}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Only http and https URLs are allowed.');
    }
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new BadRequestException('Refusing to browse internal hosts.');
    }
    const ips: string[] = [];
    if (isIP(host)) {
      ips.push(host);
    } else {
      try {
        const records = await lookup(host, { all: true });
        ips.push(...records.map((r) => r.address));
      } catch {
        throw new BadRequestException(`Could not resolve host: ${host}`);
      }
    }
    for (const ip of ips) {
      if (this.isPrivateIp(ip)) {
        throw new BadRequestException('Refusing to browse private addresses.');
      }
    }
    return url;
  }

  private isPrivateIp(ip: string): boolean {
    if (isIP(ip) === 6) {
      const v = ip.toLowerCase();
      // IPv4-mapped (::ffff:1.2.3.4) — defer to the v4 rules below.
      if (v.startsWith('::ffff:')) {
        return this.isPrivateIp(v.slice('::ffff:'.length));
      }
      return (
        v === '::1' || // loopback
        v.startsWith('fc') ||
        v.startsWith('fd') || // unique-local
        v.startsWith('fe80') // link-local
      );
    }
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // ── Operations ───────────────────────────────────────────────────

  async navigate(key: string, rawUrl: string): Promise<PageState> {
    const url = await this.assertSafeUrl(this.normalizeUrl(rawUrl));
    const session = await this.ensure(key);
    await session.page
      .goto(url.toString(), { waitUntil: 'domcontentloaded' })
      .catch((err) => {
        throw new BadRequestException(
          `Failed to load page: ${err instanceof Error ? err.message : 'error'}`,
        );
      });
    session.lastUsed = Date.now();
    return await this.state(session);
  }

  async search(
    key: string,
    query: string,
    engine?: string,
  ): Promise<{ results: SearchResult[]; state: PageState }> {
    const engineKey = (
      engine ||
      this.config.get<string>('BROWSER_DEFAULT_ENGINE') ||
      'duckduckgo'
    ).toLowerCase();

    // DuckDuckGo: use the no-key Instant Answer JSON API. Search-engine *HTML*
    // pages (Bing/DDG/Mojeek/…) serve CAPTCHAs to datacenter IPs, so scraping
    // them from the server is unreliable; the API isn't gated. We then point
    // the visible page at the top result so the viewport shows something.
    if (engineKey === 'duckduckgo') {
      const { results, navigateTo } = await this.ddgInstantAnswer(query);
      const session = await this.ensure(key);
      if (navigateTo) {
        try {
          const safe = await this.assertSafeUrl(navigateTo);
          await session.page
            .goto(safe.toString(), { waitUntil: 'domcontentloaded' })
            .catch(() => undefined);
        } catch {
          /* unsafe/invalid top result — just return the list */
        }
      }
      session.lastUsed = Date.now();
      return { results, state: await this.state(session) };
    }

    // Other engines (e.g. Bing): navigate + scrape the rendered page. May hit a
    // CAPTCHA the user can solve interactively; results parsing is best-effort.
    const def = ENGINES[engineKey] ?? ENGINES.bing;
    const session = await this.ensure(key);
    await session.page.goto(def.buildUrl(query), {
      waitUntil: 'domcontentloaded',
    });
    if (def.waitFor) {
      await session.page
        .waitForSelector(def.waitFor, { timeout: 6000 })
        .catch(() => undefined);
    }
    session.lastUsed = Date.now();
    const results = await session.page.evaluate(def.parse);
    return {
      results: results.filter((r) => r.url),
      state: await this.state(session),
    };
  }

  /**
   * DuckDuckGo Instant Answer API (no key, not CAPTCHA-gated). Returns the
   * abstract + related topics + any direct results. It's not a full web-search
   * index, but it's reliable from a server. `navigateTo` is the best page to
   * show in the viewport (the abstract, else the first result).
   */
  private async ddgInstantAnswer(
    query: string,
  ): Promise<{ results: SearchResult[]; navigateTo?: string }> {
    const api = `https://api.duckduckgo.com/?q=${encodeURIComponent(
      query,
    )}&format=json&no_html=1&no_redirect=1&t=stack62`;
    const results: SearchResult[] = [];
    try {
      const res = await fetch(api);
      const data = (await res.json()) as {
        Heading?: string;
        AbstractText?: string;
        AbstractURL?: string;
        Results?: Array<{ Text?: string; FirstURL?: string }>;
        RelatedTopics?: Array<{
          Text?: string;
          FirstURL?: string;
          Topics?: Array<{ Text?: string; FirstURL?: string }>;
        }>;
      };
      if (data.AbstractURL) {
        results.push({
          title: data.Heading || query,
          url: data.AbstractURL,
          snippet: data.AbstractText || '',
        });
      }
      for (const r of data.Results ?? []) {
        if (r.FirstURL && r.Text) {
          results.push({ title: r.Text, url: r.FirstURL, snippet: '' });
        }
      }
      const walk = (
        topics: Array<{
          Text?: string;
          FirstURL?: string;
          Topics?: Array<{ Text?: string; FirstURL?: string }>;
        }> = [],
      ) => {
        for (const t of topics) {
          if (t.Topics) walk(t.Topics);
          else if (t.FirstURL && t.Text) {
            results.push({ title: t.Text, url: t.FirstURL, snippet: '' });
          }
        }
      };
      walk(data.RelatedTopics);
    } catch {
      /* network/parse failure → empty list */
    }
    const trimmed = results.slice(0, 15);
    return { results: trimmed, navigateTo: trimmed[0]?.url };
  }

  async action(key: string, action: BrowserAction): Promise<PageState> {
    const session = await this.ensure(key);
    const { page } = session;
    switch (action.type) {
      case 'click':
        await page.mouse.click(action.x, action.y);
        break;
      case 'type':
        await page.keyboard.type(action.text);
        break;
      case 'key':
        await page.keyboard.press(action.key);
        break;
      case 'scroll':
        await page.mouse.wheel(0, action.deltaY);
        break;
      case 'back':
        await page
          .goBack({ waitUntil: 'domcontentloaded' })
          .catch(() => undefined);
        break;
      case 'forward':
        await page
          .goForward({ waitUntil: 'domcontentloaded' })
          .catch(() => undefined);
        break;
      case 'reload':
        await page
          .reload({ waitUntil: 'domcontentloaded' })
          .catch(() => undefined);
        break;
    }
    // Give click-driven navigations a brief moment to settle.
    await page
      .waitForLoadState('domcontentloaded', { timeout: 5000 })
      .catch(() => undefined);
    session.lastUsed = Date.now();
    return await this.state(session);
  }

  async screenshot(key: string): Promise<Buffer> {
    const session = await this.ensure(key);
    session.lastUsed = Date.now();
    return session.page.screenshot({ type: 'jpeg', quality: 70 });
  }

  async content(key: string): Promise<PageContent> {
    const session = await this.ensure(key);
    session.lastUsed = Date.now();
    const extracted = (await session.page.evaluate(() => {
      const text = (document.body?.innerText ?? '').replace(/\s+\n/g, '\n');
      const links = Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 100)
        .map((a) => ({
          text: (a.textContent ?? '').trim().slice(0, 120),
          url: (a as HTMLAnchorElement).href,
        }))
        .filter((l) => l.text && l.url.startsWith('http'));
      return { title: document.title, text, links };
    })) as { title: string; text: string; links: PageContent['links'] };
    return {
      url: session.page.url(),
      title: extracted.title,
      text: extracted.text.slice(0, 16000),
      links: extracted.links,
    };
  }

  hasSession(key: string): boolean {
    const s = this.sessions.get(key);
    return !!s && !s.page.isClosed();
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async state(session: Session): Promise<PageState> {
    const title = await session.page.title().catch(() => '');
    return { url: session.page.url(), title };
  }

  /** Add a scheme when the user typed a bare host like "example.com". */
  private normalizeUrl(raw: string): string {
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }
}
