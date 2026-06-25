import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrowserHistoryEntity } from './entities/browser-history.entity';
import {
  BrowserAction,
  BrowserSessionService,
  PageContent,
  PageState,
  SearchResult,
} from './browser-session.service';

export interface BrowserScope {
  organizationId: string;
  workspaceId?: string | null;
  userId: string;
}

/**
 * Thin orchestration layer over BrowserSessionService: resolves the shared
 * per-workspace session key, records browsing history, and is the single
 * surface used by both the HTTP controller and the coworker web.* tools.
 */
@Injectable()
export class BrowserService {
  constructor(
    private readonly sessions: BrowserSessionService,
    @InjectRepository(BrowserHistoryEntity)
    private readonly historyRepo: Repository<BrowserHistoryEntity>,
  ) {}

  isEnabled(): boolean {
    return this.sessions.isEnabled();
  }

  private key(scope: BrowserScope): string {
    return this.sessions.sessionKey(scope.organizationId, scope.workspaceId);
  }

  async navigate(scope: BrowserScope, url: string): Promise<PageState> {
    const state = await this.sessions.navigate(this.key(scope), url);
    await this.record(scope, state);
    return state;
  }

  async search(
    scope: BrowserScope,
    query: string,
    engine?: string,
  ): Promise<{ results: SearchResult[]; state: PageState }> {
    return this.sessions.search(this.key(scope), query, engine);
  }

  async action(scope: BrowserScope, action: BrowserAction): Promise<PageState> {
    const state = await this.sessions.action(this.key(scope), action);
    await this.record(scope, state);
    return state;
  }

  screenshot(scope: BrowserScope): Promise<Buffer> {
    return this.sessions.screenshot(this.key(scope));
  }

  content(scope: BrowserScope): Promise<PageContent> {
    return this.sessions.content(this.key(scope));
  }

  /** Best-effort history write — never block or fail a navigation on it. */
  private async record(scope: BrowserScope, state: PageState): Promise<void> {
    if (!state.url || state.url === 'about:blank') return;
    await this.historyRepo
      .save(
        this.historyRepo.create({
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId ?? null,
          userId: scope.userId,
          url: state.url.slice(0, 2048),
          title: state.title ? state.title.slice(0, 500) : null,
        }),
      )
      .catch(() => undefined);
  }
}
