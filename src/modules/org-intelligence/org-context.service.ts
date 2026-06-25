import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';
import { MembershipsService } from '../memberships/memberships.service';
import { SchedulesService } from '../schedules/schedules.service';
import { SemanticSearchService } from '../semantic-search/semantic-search.service';

export interface OrgBrief {
  /** Human-readable brief, ready to drop into a system prompt. */
  text: string;
  /** False when no facts could be assembled (skip Tier 1.5, don't pad prompts). */
  hasContent: boolean;
}

/**
 * Assembles the "org brain" brief the coworker reasons over: who's on the team
 * and their roles, which tools are connected, what's coming up, and the most
 * relevant document snippets for the question at hand. Built live from existing
 * services (each source is access-controlled and independently fault-tolerant)
 * so the brief always respects permissions and never hard-fails a chat.
 */
@Injectable()
export class OrgContextService {
  private readonly logger = new Logger(OrgContextService.name);

  constructor(
    private readonly memberships: MembershipsService,
    private readonly integrations: IntegrationsService,
    private readonly schedules: SchedulesService,
    private readonly semanticSearch: SemanticSearchService,
  ) {}

  async buildBrief(
    organizationId: string,
    workspaceId: string | null,
    actorUserId: string,
    opts: { query?: string; ragLimit?: number } = {},
  ): Promise<OrgBrief> {
    const sections: string[] = [];

    const team = await this.teamSection(
      organizationId,
      workspaceId,
      actorUserId,
    );
    if (team) sections.push(team);

    const tools = await this.toolsSection(
      organizationId,
      workspaceId,
      actorUserId,
    );
    if (tools) sections.push(tools);

    const upcoming = await this.scheduleSection(
      organizationId,
      workspaceId,
      actorUserId,
    );
    if (upcoming) sections.push(upcoming);

    if (opts.query) {
      const docs = await this.ragSection(
        organizationId,
        actorUserId,
        opts.query,
        opts.ragLimit ?? 5,
      );
      if (docs) sections.push(docs);
    }

    if (sections.length === 0) {
      return { text: '', hasContent: false };
    }
    return {
      text: ['## Organization context', ...sections].join('\n\n'),
      hasContent: true,
    };
  }

  private async teamSection(
    organizationId: string,
    workspaceId: string | null,
    actorUserId: string,
  ): Promise<string | null> {
    try {
      const members = await this.memberships.findAllWithUsers(
        { organizationId, workspaceId: workspaceId ?? undefined } as never,
        actorUserId,
      );
      if (!members.length) return null;
      const lines = members.slice(0, 40).map((m) => {
        const name =
          [m.user?.firstName, m.user?.lastName].filter(Boolean).join(' ') ||
          m.user?.email ||
          'Unknown';
        return `- ${name} — ${m.role}`;
      });
      const roleCounts = new Map<string, number>();
      for (const m of members) {
        roleCounts.set(m.role, (roleCounts.get(m.role) ?? 0) + 1);
      }
      const summary = Array.from(roleCounts.entries())
        .map(([role, n]) => `${n} ${role}`)
        .join(', ');
      return `### Team (${members.length}: ${summary})\n${lines.join('\n')}`;
    } catch (err) {
      this.logger.warn(`team section failed: ${msg(err)}`);
      return null;
    }
  }

  private async toolsSection(
    organizationId: string,
    workspaceId: string | null,
    actorUserId: string,
  ): Promise<string | null> {
    try {
      const conns = (await this.integrations.listConnections(
        { organizationId, workspaceId: workspaceId ?? undefined } as never,
        actorUserId,
      )) as Array<{ providerKey?: string; status?: string }>;
      const active = conns
        .filter((c) => (c.status ?? 'active') !== 'deleted')
        .map((c) => c.providerKey)
        .filter((k): k is string => Boolean(k));
      if (!active.length) return null;
      return `### Connected tools\n${Array.from(new Set(active)).join(', ')}`;
    } catch (err) {
      this.logger.warn(`tools section failed: ${msg(err)}`);
      return null;
    }
  }

  private async scheduleSection(
    organizationId: string,
    workspaceId: string | null,
    actorUserId: string,
  ): Promise<string | null> {
    try {
      const rows = (await this.schedules.findAll(
        {
          organizationId,
          workspaceId: workspaceId ?? undefined,
          status: 'scheduled',
        } as never,
        actorUserId,
      )) as Array<{ title: string; startsAt: Date | null }>;
      const now = Date.now();
      const upcoming = rows
        .filter((r) => !r.startsAt || new Date(r.startsAt).getTime() >= now)
        .slice(0, 8)
        .map((r) => {
          const when = r.startsAt
            ? new Date(r.startsAt).toISOString().slice(0, 16).replace('T', ' ')
            : 'unscheduled';
          return `- ${r.title} (${when})`;
        });
      if (!upcoming.length) return null;
      return `### Upcoming\n${upcoming.join('\n')}`;
    } catch (err) {
      this.logger.warn(`schedule section failed: ${msg(err)}`);
      return null;
    }
  }

  private async ragSection(
    organizationId: string,
    actorUserId: string,
    query: string,
    limit: number,
  ): Promise<string | null> {
    try {
      const hits = await this.semanticSearch.searchSimilar(
        organizationId,
        query,
        actorUserId,
        { limit },
      );
      if (!hits.length) return null;
      const snippets = hits.map((h) => {
        const src = h.filename ? ` [${h.filename}]` : '';
        return `- ${h.text.slice(0, 400).trim()}${src}`;
      });
      return `### Relevant documents\n${snippets.join('\n')}`;
    } catch (err) {
      this.logger.warn(`rag section failed: ${msg(err)}`);
      return null;
    }
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
