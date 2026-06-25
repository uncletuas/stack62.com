import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { LlmService } from '../engine/llm/llm.service';
import { OllamaClient } from '../engine/ollama.client';
import { BudgetGovernorService } from '../org-intelligence/budget-governor.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { SemanticSearchService } from '../semantic-search/semantic-search.service';
import { WidgetTokenEntity } from './entities/widget-token.entity';

export interface CreateWidgetTokenInput {
  organizationId: string;
  workspaceId?: string | null;
  label: string;
  allowedOrigins?: string[];
  knowledgeBase?: string | null;
  useDocumentSearch?: boolean;
  greeting?: string | null;
  expiresAt?: string | null;
}

export interface WidgetChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const TOKEN_PREFIX = 's62w_';
const MAX_HISTORY = 8;

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    @InjectRepository(WidgetTokenEntity)
    private readonly tokensRepo: Repository<WidgetTokenEntity>,
    private readonly accessControl: AccessControlService,
    private readonly organizations: OrganizationsService,
    private readonly semanticSearch: SemanticSearchService,
    private readonly llm: LlmService,
    private readonly ollama: OllamaClient,
    private readonly budget: BudgetGovernorService,
  ) {}

  // ── Admin token management ───────────────────────────────────────────────

  async createToken(input: CreateWidgetTokenInput, actorUserId: string) {
    await this.assertManage(input.organizationId, actorUserId);
    const raw = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    const entity = this.tokensRepo.create({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      label: input.label,
      tokenHash: hashToken(raw),
      tokenPrefix: raw.slice(0, 12),
      allowedOrigins: normalizeOrigins(input.allowedOrigins),
      knowledgeBase: input.knowledgeBase ?? null,
      useDocumentSearch: input.useDocumentSearch ?? false,
      greeting: input.greeting ?? null,
      active: true,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdByUserId: actorUserId,
      lastUsedAt: null,
    });
    const saved = await this.tokensRepo.save(entity);
    // Return the raw token ONCE — it is never retrievable again.
    return { ...this.publicShape(saved), token: raw };
  }

  async listTokens(organizationId: string, actorUserId: string) {
    await this.assertManage(organizationId, actorUserId);
    const rows = await this.tokensRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.publicShape(r));
  }

  async revokeToken(id: string, actorUserId: string) {
    const token = await this.tokensRepo.findOne({ where: { id } });
    if (!token) throw new NotFoundException('Widget token not found.');
    await this.assertManage(token.organizationId, actorUserId);
    token.active = false;
    await this.tokensRepo.save(token);
    return { ok: true };
  }

  async updateToken(
    id: string,
    input: Partial<CreateWidgetTokenInput>,
    actorUserId: string,
  ) {
    const token = await this.tokensRepo.findOne({ where: { id } });
    if (!token) throw new NotFoundException('Widget token not found.');
    await this.assertManage(token.organizationId, actorUserId);
    if (input.label !== undefined) token.label = input.label;
    if (input.allowedOrigins !== undefined)
      token.allowedOrigins = normalizeOrigins(input.allowedOrigins);
    if (input.knowledgeBase !== undefined)
      token.knowledgeBase = input.knowledgeBase;
    if (input.useDocumentSearch !== undefined)
      token.useDocumentSearch = input.useDocumentSearch;
    if (input.greeting !== undefined) token.greeting = input.greeting;
    if (input.expiresAt !== undefined)
      token.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    await this.tokensRepo.save(token);
    return this.publicShape(token);
  }

  // ── Public widget runtime ────────────────────────────────────────────────

  /** Resolve an active, unexpired token from its raw value, or null. */
  async verifyToken(
    raw: string | undefined | null,
  ): Promise<WidgetTokenEntity | null> {
    if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null;
    const token = await this.tokensRepo.findOne({
      where: { tokenHash: hashToken(raw) },
    });
    if (!token || !token.active) return null;
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;
    return token;
  }

  /** Is `origin` permitted for this token? Empty allowlist = allow (dev). */
  isOriginAllowed(
    token: WidgetTokenEntity,
    origin: string | undefined,
  ): boolean {
    if (!token.allowedOrigins.length) return true;
    if (!origin) return false;
    return token.allowedOrigins.includes(origin.toLowerCase());
  }

  /**
   * Answer a visitor's question, grounded ONLY in the token's curated knowledge
   * base plus (optionally) the org's indexed documents. Prefers the local model
   * ($0); falls back to the budgeted frontier model. Never touches CRM data or
   * tools.
   */
  async answer(
    token: WidgetTokenEntity,
    question: string,
    history: WidgetChatTurn[] = [],
  ): Promise<string> {
    const context = await this.buildContext(token, question);
    const system = [
      'You are the website assistant for this organization. Answer the ' +
        "visitor's question using ONLY the context below. Be friendly, concise, " +
        'and accurate. If the answer is not in the context, say you are not sure ' +
        'and offer to connect them with the team. Never invent facts, prices, or ' +
        'policies.',
      '',
      '=== CONTEXT ===',
      context || '(no specific context provided)',
    ].join('\n');

    const trimmedHistory = history
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));

    // Touch lastUsedAt (best-effort, fire and forget).
    void this.tokensRepo
      .update(token.id, { lastUsedAt: new Date() })
      .catch(() => undefined);

    // Prefer the local model — zero API cost.
    if (await this.ollama.isAvailable()) {
      try {
        const local = await this.ollama.complete([
          { role: 'system', content: system },
          ...trimmedHistory,
          { role: 'user', content: question },
        ]);
        const trimmed = local.trim();
        if (trimmed) return trimmed;
      } catch (err) {
        this.logger.warn(`Widget local answer failed, escalating: ${msg(err)}`);
      }
    }

    // Frontier fallback — metered against the org budget.
    const preferred = this.llm.resolveModel();
    const choice = await this.budget.chooseModel(
      token.organizationId,
      preferred,
    );
    if (choice.model === null) {
      return "I'm temporarily unavailable. Please reach out to the team directly and they'll be happy to help.";
    }
    const completion = await this.llm.complete({
      model: choice.model,
      system,
      messages: [
        ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: question },
      ],
      maxTokens: 600,
    });
    if (completion.usage) {
      void this.budget.recordSpend(
        token.organizationId,
        completion.model || choice.model,
        completion.usage.input_tokens,
        completion.usage.output_tokens,
      );
    }
    const text = completion.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || "Thanks for reaching out — I'll have the team follow up.";
  }

  private async buildContext(
    token: WidgetTokenEntity,
    question: string,
  ): Promise<string> {
    const parts: string[] = [];
    if (token.knowledgeBase?.trim()) parts.push(token.knowledgeBase.trim());

    if (token.useDocumentSearch) {
      try {
        const org = await this.organizations.findById(token.organizationId);
        const ownerId = (org as { ownerUserId?: string } | null)?.ownerUserId;
        if (ownerId) {
          const hits = await this.semanticSearch.searchSimilar(
            token.organizationId,
            question,
            ownerId,
            { limit: 5 },
          );
          for (const h of hits) parts.push(h.text.slice(0, 600).trim());
        }
      } catch (err) {
        this.logger.warn(`Widget document search failed: ${msg(err)}`);
      }
    }
    return parts.join('\n\n---\n\n');
  }

  private publicShape(t: WidgetTokenEntity) {
    return {
      id: t.id,
      organizationId: t.organizationId,
      workspaceId: t.workspaceId,
      label: t.label,
      tokenPrefix: t.tokenPrefix,
      allowedOrigins: t.allowedOrigins,
      knowledgeBase: t.knowledgeBase,
      useDocumentSearch: t.useDocumentSearch,
      greeting: t.greeting,
      active: t.active,
      expiresAt: t.expiresAt,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
    };
  }

  private async assertManage(organizationId: string, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'ai_change_request',
      action: 'manage_ai',
      organizationId,
    });
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function normalizeOrigins(origins?: string[]): string[] {
  if (!origins) return [];
  return Array.from(
    new Set(
      origins
        .map((o) => o.trim().toLowerCase().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
