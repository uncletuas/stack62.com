import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CoworkerMemoryService } from '../coworker/coworker-memory.service';
import { CoworkerService } from '../coworker/coworker.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { type AnthropicMessage } from './anthropic.client';
import { LlmService } from './llm/llm.service';
import { CoworkerRuntimeService } from './coworker-runtime.service';
import {
  IntentClassifierService,
  type RouterTier,
} from './intent-classifier.service';
import { ToolRegistry } from './tools/registry';
import type { ToolContext } from './tools/types';
import {
  ResponseCacheService,
  type CacheableResult,
} from '../org-intelligence/response-cache.service';
import { BudgetGovernorService } from '../org-intelligence/budget-governor.service';
import {
  OrgContextService,
  type OrgBrief,
} from '../org-intelligence/org-context.service';
import { OllamaClient } from './ollama.client';

export type EngineEvent =
  | { type: 'session.started'; sessionId: string; model: string }
  | {
      type: 'session.routed';
      tier: RouterTier;
      reason: string;
      tool?: string;
    }
  | { type: 'message.delta'; text: string }
  | { type: 'message.complete'; text: string }
  | {
      type: 'tool.call';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool.result';
      id: string;
      name: string;
      ok: boolean;
      summary?: string;
      output: unknown;
    }
  | { type: 'session.complete'; turns: number; stopReason: string }
  | { type: 'session.error'; message: string };

export interface EngineSessionInput {
  ctx: ToolContext;
  prompt: string;
  history?: AnthropicMessage[];
  systemHint?: string;
  model?: string;
  maxTurns?: number;
  maxTokens?: number;
  /**
   * If true, the coworker acts without confirmation prompts.
   * If false, the coworker confirms destructive actions first.
   * Defaults to the coworker config's `defaultAutopilot`.
   */
  autopilot?: boolean;
  /**
   * When true, only read-like tools (actionLevel ≤ 1, non-sensitive) are
   * exposed and mutating dispatches are denied. Used by untrusted surfaces
   * such as the public website widget.
   */
  readOnly?: boolean;
  /**
   * When set, restricts the tools the model may use to those whose internal
   * dotted name starts with one of these prefixes (e.g. ['web.', 'documents.',
   * 'workspace.search']). Combined with `readOnly` for the public widget.
   */
  toolAllowlist?: string[];
}

const DEFAULT_MAX_TURNS = 10;

const BASE_PROMPT = `You operate Stack62, the working surface of a business workspace. You are talking with a non-technical operator.

Always:
- Be concise and decisive. Plain language. No jargon.
- Treat Stack62 as your local execution engine. The language model is only the intelligence layer; Stack62 tools perform the actual building, editing, scheduling, testing, deployment, repair, and cleanup.
- Use tools to inspect the workspace (systems, modules, records, files, jobs, schedules, tasks, integrations) before guessing. Lists and reads are free; perform them when relevant.
- For any action that creates, updates, restarts, repairs, deploys, stops, deletes, or sends, execute it with tools. Do not tell the operator to open another page or do the work manually when a tool can do it.
- Schema changes (new modules, fields, workflows) go through plans.propose internally. Plans are applied automatically after validation unless the operator asks to stop or undo.
- For recurring or scheduled work the operator wants done automatically, create a job with jobs.create. Each job runs by itself when its trigger fires.
- For one-off TODOs assigned to a person, use tasks.create. For meetings/deadlines/reminders use schedules.create.
- When the user asks to "send X to Y", use the connected integration. If the connection is missing, say which one and where to add it.
- When the user asks to "open", "show", or "pull up" a specific file, folder, system, task, schedule, plan, or report — call workspace.open with the target and id. The frontend renders a clickable chip; the user is one click away from the thing. When you reference something the user might want to jump to next, also call workspace.open so the reference is followable.
- For collaborative editing the user can do alongside you, prefer the AI-native workspace docs (office.workspace_create → office.dispatch_action for every edit) over generating file exports (office.create_doc → file in storage). The workspace docs are live, shared, and you can edit them in real time. Use file-export tools only when the user explicitly wants a downloadable .docx/.xlsx/.pptx. After office.workspace_create returns, call workspace.open with target='workspace-doc' / 'workspace-sheet' / 'workspace-slides' so the user lands on the doc you just made.
- When unsure of something the workspace already knows (a system id, a person, a record) — read it first.
- If a build, deployment, or repair fails, gather logs, retry the smallest useful repair, and report the exact failure only after the local engine cannot fix it.

Never:
- Show raw IDs as the only output. Always pair them with a name or short summary.
- Invent connections, tools, or capabilities you don't see in the available tools list.
- Ask for confirmation for normal system builds, edits, deployments, task creation, scheduling, or repairs.
- Apply high-risk destructive operations (sending money, permanently deleting shared business data) without confirmation.`;

// System prompt for the local conversational tier. The local model answers
// advice/Q&A/drafting directly; if the user actually wants an action performed,
// it returns ESCALATE so the frontier tool loop takes over.
const LOCAL_CHAT_PROMPT = `You are the user's AI coworker, replying in a chat. Answer helpfully, concisely, and in plain language. You can give advice, explanations, summaries, comparisons, and DRAFT text (emails, messages, notes, plans) when asked.

You are in conversation mode and cannot use tools or change anything right now. If the user is explicitly asking you to PERFORM an action in their workspace — create/update/delete a record or task, send an email or message, schedule something, build or deploy a system, run a job, or make a payment — reply with ONLY the single word ESCALATE and nothing else, so a more capable system can carry it out. Otherwise, just answer the user directly.`;

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly tools: ToolRegistry,
    private readonly organizationsService: OrganizationsService,
    private readonly coworkerRuntimeService: CoworkerRuntimeService,
    @Inject(forwardRef(() => CoworkerService))
    private readonly coworkerService: CoworkerService,
    @Inject(forwardRef(() => CoworkerMemoryService))
    private readonly coworkerMemoryService: CoworkerMemoryService,
    private readonly intentClassifier: IntentClassifierService,
    private readonly integrationsService: IntegrationsService,
    private readonly responseCache: ResponseCacheService,
    private readonly budgetGovernor: BudgetGovernorService,
    private readonly orgContext: OrgContextService,
    private readonly ollama: OllamaClient,
  ) {}

  async *run(
    input: EngineSessionInput,
  ): AsyncGenerator<EngineEvent, void, void> {
    const sessionId = `eng-${Date.now().toString(36)}-${Math.random()
      .toString(16)
      .slice(2, 8)}`;
    let model = this.llm.resolveModel(input.model);
    const orgKey = await this.resolveOrgKey(input.ctx.organizationId);

    yield { type: 'session.started', sessionId, model };

    if (shouldCreateSchedule(input.prompt)) {
      const runtime = this.coworkerRuntimeService.runSchedule(input);
      for await (const event of runtime) {
        yield event;
      }
      return;
    }

    if (shouldCreatePlan(input.prompt)) {
      if (!input.ctx.workspaceId) {
        yield {
          type: 'session.error',
          message:
            'A workspace is required before the coworker can build a system.',
        };
        return;
      }

      const runtime = this.coworkerRuntimeService.runBuild(input, model);
      for await (const event of runtime) {
        yield event;
      }
      return;
    }

    // ── Tiered router (Tier 0 deterministic / Tier 1 local model) ────────
    // The classifier inspects the prompt and either short-circuits to a
    // direct tool dispatch or a static reply, or signals "escalate" so we
    // fall through to the full Claude tool-calling loop.
    try {
      const decision = await this.intentClassifier.classify({
        prompt: input.prompt,
        history: (input.history ?? [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : m.content.map((b) => ('text' in b ? b.text : '')).join('\n'),
          })),
        tools: this.tools.list(),
      });
      yield {
        type: 'session.routed',
        tier: decision.tier,
        reason: decision.reason,
        tool: decision.tool?.name,
      };
      if (
        (decision.tier === 0 || decision.tier === 1) &&
        decision.directReply
      ) {
        yield { type: 'message.complete', text: decision.directReply };
        yield {
          type: 'session.complete',
          turns: 0,
          stopReason: `tier${decision.tier}_direct`,
        };
        // Static (tier 0) and self-contained generative (tier 1) replies are a
        // pure function of the prompt — safe to replay verbatim.
        void this.responseCache.store(
          input.ctx.organizationId,
          input.ctx.workspaceId ?? null,
          input.prompt,
          { kind: 'reply', reply: decision.directReply },
        );
        return;
      }
      if ((decision.tier === 0 || decision.tier === 1) && decision.tool) {
        const useId = `tier${decision.tier}-${Date.now().toString(36)}`;
        yield {
          type: 'tool.call',
          id: useId,
          name: decision.tool.name,
          input: decision.tool.input,
        };
        try {
          const result = await this.tools.dispatch(
            decision.tool.name,
            decision.tool.input,
            input.ctx,
          );
          yield {
            type: 'tool.result',
            id: useId,
            name: decision.tool.name,
            ok: true,
            summary: result.summary,
            output: result.output,
          };
          const reply =
            result.summary ??
            `Done. ${decision.tool.name} returned ${describeToolOutput(result.output)}.`;
          yield { type: 'message.complete', text: reply };
          yield {
            type: 'session.complete',
            turns: 1,
            stopReason: `tier${decision.tier}_tool`,
          };
          // Cache read-like tool resolutions so the same intent skips even the
          // local classifier next time and replays the tool live (fresh data).
          if (this.tools.isReadLike(decision.tool.name)) {
            void this.responseCache.store(
              input.ctx.organizationId,
              input.ctx.workspaceId ?? null,
              input.prompt,
              {
                kind: 'tool',
                toolName: decision.tool.name,
                toolInput: decision.tool.input,
              },
            );
          }
          return;
        } catch (err) {
          // Tier-0/1 dispatch failed — fall through to full LLM loop so
          // Claude can recover.
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Tier-${decision.tier} dispatch failed for ${decision.tool.name}: ${message}; escalating.`,
          );
          yield {
            type: 'tool.result',
            id: useId,
            name: decision.tool.name,
            ok: false,
            summary: message,
            output: { error: message },
          };
        }
      }
    } catch (err) {
      // Classifier itself failed — log and fall through.
      this.logger.warn(
        `Intent classifier failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── Semantic response cache ──────────────────────────────────────────
    // Before paying for a frontier completion, check whether a near-identical
    // prompt was resolved locally before for this org. A hit replays at $0:
    // a static reply verbatim, or a read-only tool re-dispatched live.
    const cached = await this.responseCache.lookup(
      input.ctx.organizationId,
      input.ctx.workspaceId ?? null,
      input.prompt,
    );
    // Only replay when the result is still valid: a static reply, or a tool
    // that still exists and is still read-like. Otherwise fall through.
    const replayable =
      cached?.result.kind === 'reply' ||
      (cached?.result.kind === 'tool' &&
        this.tools.isReadLike(cached.result.toolName));
    if (cached && replayable) {
      yield {
        type: 'session.routed',
        tier: 1,
        reason: `response cache (${cached.source}, ${cached.score.toFixed(2)})`,
      };
      yield* this.replayFromCache(cached.result, input.ctx);
      return;
    }

    // ── Org knowledge brief ──────────────────────────────────────────────
    // Assemble the org "brain" once (team, tools, schedule, relevant docs).
    // Used by Tier 1.5 (answer locally) and, on escalation, to make the
    // frontier model organizationally aware. Best-effort — never blocks chat.
    let orgBrief: OrgBrief | null = null;
    try {
      orgBrief = await this.orgContext.buildBrief(
        input.ctx.organizationId,
        input.ctx.workspaceId ?? null,
        input.ctx.actorUserId,
        { query: input.prompt },
      );
    } catch {
      orgBrief = null;
    }

    // ── Tier 1.5 — local org-knowledge answer ────────────────────────────
    // For "who/what/when" questions about the org, answer from the brief on
    // the local model — no frontier call.
    if (
      isOrgKnowledgeQuestion(input.prompt) &&
      orgBrief?.hasContent &&
      (await this.ollama.isAvailable())
    ) {
      try {
        const answer = await this.ollama.complete([
          {
            role: 'system',
            content:
              'You answer questions about this organization using ONLY the ' +
              'context below. Be concise and specific. If the answer is not in ' +
              'the context, reply with the single token NEED_CONTEXT.\n\n' +
              orgBrief.text,
          },
          { role: 'user', content: input.prompt },
        ]);
        const trimmed = answer.trim();
        if (trimmed && !trimmed.includes('NEED_CONTEXT')) {
          yield {
            type: 'session.routed',
            tier: 1,
            reason: 'local org-knowledge answer (no API)',
          };
          yield { type: 'message.complete', text: trimmed };
          yield {
            type: 'session.complete',
            turns: 0,
            stopReason: 'tier1_org_qa',
          };
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Tier-1.5 org QA failed, escalating: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const messages: AnthropicMessage[] = [
      ...(input.history ?? []),
      { role: 'user', content: input.prompt },
    ];

    let coworkerHint = '';
    if (input.ctx.workspaceId) {
      try {
        const coworker = await this.coworkerService.getOrCreate(
          input.ctx.organizationId,
          input.ctx.workspaceId,
          input.ctx.actorUserId,
        );
        const autopilot = input.autopilot ?? coworker.defaultAutopilot;
        const memories = await this.coworkerMemoryService
          .forSystemPrompt(
            input.ctx.organizationId,
            input.ctx.workspaceId,
            input.ctx.systemId ?? null,
          )
          .catch(() => []);
        coworkerHint = this.coworkerService.buildSystemPreamble(
          coworker,
          autopilot,
          memories,
        );
        // Attach the Coworker as the acting party so tool dispatches gate
        // by its role and audit logs identify it.
        input.ctx = {
          ...input.ctx,
          actor: {
            kind: 'coworker',
            userId: input.ctx.actorUserId,
            coworkerId: coworker.id,
            coworkerName: coworker.name,
            coworkerRole: coworker.role,
          },
        };
      } catch {
        /* fall back to base prompt only */
      }
    }

    // ── Tier 2 (local) — conversational answer for non-action requests ──────
    // Advice, explanations, summaries, and drafting are handled by the local
    // model at $0. Only requests that need to TAKE an action in the workspace —
    // or that the local model flags with ESCALATE — fall through to the
    // frontier tool loop (OpenAI) below.
    if (
      process.env.STACK62_LOCAL_CHAT_ENABLED !== 'false' &&
      !isActionRequest(input.prompt) &&
      (await this.ollama.isAvailable())
    ) {
      try {
        const convoSystem = [
          LOCAL_CHAT_PROMPT,
          coworkerHint,
          orgBrief?.hasContent ? orgBrief.text : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        const localHistory = (input.history ?? [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content:
              typeof m.content === 'string'
                ? m.content
                : m.content.map((b) => ('text' in b ? b.text : '')).join('\n'),
          }));
        const reply = await this.ollama.complete([
          { role: 'system', content: convoSystem },
          ...localHistory,
          { role: 'user', content: input.prompt },
        ]);
        const trimmed = reply.trim();
        if (trimmed && !trimmed.includes('ESCALATE')) {
          yield {
            type: 'session.routed',
            tier: 2,
            reason: 'local conversation (no API)',
          };
          yield { type: 'message.complete', text: trimmed };
          yield {
            type: 'session.complete',
            turns: 0,
            stopReason: 'tier2_local_chat',
          };
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Tier-2 local chat failed, escalating: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Gate the email tool on a connected mailbox: hide it when none is
    // connected and tell the Coworker to ask the user to connect, so it never
    // claims to send mail it has no account to send from.
    const emailConnected = await this.integrationsService
      .hasEmailConnection(input.ctx.organizationId, input.ctx.workspaceId)
      .catch(() => false);
    const emailHint = emailConnected
      ? ''
      : 'No email account is connected for this workspace. If the user asks to send email, do not claim you sent it — tell them to connect their email first under Tools → Marketplace (Sign in with Google, or add an SMTP account).';

    const orgHint = orgBrief?.hasContent ? orgBrief.text : '';
    const system = [
      BASE_PROMPT,
      coworkerHint,
      orgHint,
      emailHint,
      input.systemHint,
    ]
      .filter(Boolean)
      .join('\n\n');

    const toolSpecs = this.tools.specsGated({
      emailConnected,
      readOnly: input.readOnly,
      allowlist: input.toolAllowlist,
    });

    // ── Budget governor ──────────────────────────────────────────────────
    // Apply the org's monthly frontier cap before paying for completions.
    // Over budget → stop with a clear notice (the cheaper local tiers already
    // ran above). Near the cap → downgrade to the cheap frontier model.
    const budget = await this.budgetGovernor.chooseModel(
      input.ctx.organizationId,
      model,
    );
    if (budget.model === null) {
      yield {
        type: 'message.complete',
        text:
          `This workspace has reached its monthly AI budget ` +
          `($${budget.state.limitUsd.toFixed(2)}). I've handled what I can ` +
          `locally; higher-level requests will resume next cycle, or an admin ` +
          `can raise the cap in Settings → Billing.`,
      };
      yield {
        type: 'session.complete',
        turns: 0,
        stopReason: 'budget_exhausted',
      };
      return;
    }
    if (budget.downgraded && budget.model !== model) {
      this.logger.log(
        `Org ${input.ctx.organizationId} near budget cap — downgraded ${model} → ${budget.model}.`,
      );
      model = budget.model;
    }

    const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
    let turns = 0;
    let stopReason = 'unknown';
    // Track tools the frontier used. If it resolved with exactly one read-like
    // tool, we learn the prompt→tool mapping so the same intent skips frontier
    // next time (replayed live from the cache).
    const usedTools: Array<{ name: string; input: Record<string, unknown> }> =
      [];

    try {
      while (turns < maxTurns) {
        turns += 1;
        const completion = await this.llm.complete({
          model,
          system,
          messages,
          tools: toolSpecs,
          maxTokens: input.maxTokens,
          apiKey: orgKey,
        });

        const assistantContent = completion.content;
        messages.push({ role: 'assistant', content: assistantContent });
        stopReason = completion.stop_reason;

        // Meter frontier spend against the org's monthly budget.
        if (completion.usage) {
          void this.budgetGovernor.recordSpend(
            input.ctx.organizationId,
            completion.model || model,
            completion.usage.input_tokens,
            completion.usage.output_tokens,
          );
        }

        const textBlocks = assistantContent.filter(
          (b): b is { type: 'text'; text: string } => b.type === 'text',
        );
        const text = textBlocks
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (text) {
          yield { type: 'message.complete', text };
        }

        if (completion.stop_reason !== 'tool_use') {
          break;
        }

        const toolUses = assistantContent.filter(
          (
            b,
          ): b is {
            type: 'tool_use';
            id: string;
            name: string;
            input: Record<string, unknown>;
          } => b.type === 'tool_use',
        );

        const toolResults: Array<{
          type: 'tool_result';
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }> = [];

        for (const use of toolUses) {
          const friendlyName = this.tools.resolveName(use.name);
          usedTools.push({ name: friendlyName, input: use.input });
          yield {
            type: 'tool.call',
            id: use.id,
            name: friendlyName,
            input: use.input,
          };
          // Enforce read-only / allowlist scope at dispatch even if the model
          // tries a tool outside its sandbox (defense in depth for the widget).
          if (
            (input.readOnly || input.toolAllowlist) &&
            !this.tools.isAllowed(use.name, {
              readOnly: input.readOnly,
              allowlist: input.toolAllowlist,
            })
          ) {
            const denial = `Tool ${friendlyName} is not permitted in this context.`;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: JSON.stringify({ error: denial }),
              is_error: true,
            });
            yield {
              type: 'tool.result',
              id: use.id,
              name: friendlyName,
              ok: false,
              summary: denial,
              output: { error: denial },
            };
            continue;
          }
          try {
            const result = await this.tools.dispatch(
              use.name,
              use.input,
              input.ctx,
            );
            const content = JSON.stringify(result.output ?? null);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content,
            });
            yield {
              type: 'tool.result',
              id: use.id,
              name: friendlyName,
              ok: true,
              summary: result.summary,
              output: result.output,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Tool failed.';
            toolResults.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: JSON.stringify({ error: message }),
              is_error: true,
            });
            yield {
              type: 'tool.result',
              id: use.id,
              name: friendlyName,
              ok: false,
              summary: message,
              output: { error: message },
            };
          }
        }

        if (toolResults.length === 0) break;
        messages.push({ role: 'user', content: toolResults });
      }

      yield { type: 'session.complete', turns, stopReason };

      // Learn from a clean frontier resolution: exactly one tool, read-like,
      // ended normally. Replaying it later skips the paid call entirely.
      if (
        stopReason === 'end_turn' &&
        usedTools.length === 1 &&
        this.tools.isReadLike(usedTools[0].name)
      ) {
        void this.responseCache.store(
          input.ctx.organizationId,
          input.ctx.workspaceId ?? null,
          input.prompt,
          {
            kind: 'tool',
            toolName: usedTools[0].name,
            toolInput: usedTools[0].input,
          },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Engine session failed: ${message}`);
      yield { type: 'session.error', message };
    }
  }

  /**
   * Replay a cached resolution as engine events. A reply is emitted verbatim;
   * a tool is re-dispatched live so its data is fresh. Both cost $0 (no
   * frontier call).
   */
  private async *replayFromCache(
    result: CacheableResult,
    ctx: ToolContext,
  ): AsyncGenerator<EngineEvent, void, void> {
    if (result.kind === 'reply') {
      yield { type: 'message.complete', text: result.reply };
      yield { type: 'session.complete', turns: 0, stopReason: 'cache_reply' };
      return;
    }
    const useId = `cache-${Date.now().toString(36)}`;
    yield {
      type: 'tool.call',
      id: useId,
      name: result.toolName,
      input: result.toolInput,
    };
    try {
      const out = await this.tools.dispatch(
        result.toolName,
        result.toolInput,
        ctx,
      );
      yield {
        type: 'tool.result',
        id: useId,
        name: result.toolName,
        ok: true,
        summary: out.summary,
        output: out.output,
      };
      yield {
        type: 'message.complete',
        text:
          out.summary ??
          `Done. ${result.toolName} returned ${describeToolOutput(out.output)}.`,
      };
      yield { type: 'session.complete', turns: 1, stopReason: 'cache_tool' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'tool.result',
        id: useId,
        name: result.toolName,
        ok: false,
        summary: message,
        output: { error: message },
      };
      yield {
        type: 'session.complete',
        turns: 1,
        stopReason: 'cache_tool_error',
      };
    }
  }

  private async resolveOrgKey(organizationId: string): Promise<string | null> {
    try {
      const org = await this.organizationsService.findById(organizationId);
      const key = (org as { openrouterApiKey?: string | null } | null)
        ?.openrouterApiKey;
      return key ?? null;
    } catch {
      return null;
    }
  }
}

function shouldCreatePlan(prompt: string): boolean {
  if (isRestartDevelopmentPrompt(prompt)) return true;
  return /\b(build|create|design|make|generate)\b[\s\S]{0,80}\b(system|crm|erp|tracker|dashboard|workspace|database|app|application)\b/i.test(
    prompt,
  );
}

function isRestartDevelopmentPrompt(prompt: string): boolean {
  return /\b(restart|resume|continue|improve|fix|rebuild)\b[\s\S]{0,80}\b(development|work|system|app|build)\b/i.test(
    prompt,
  );
}

/** A short, safe description of a tool's output for a user-facing summary. */
function describeToolOutput(output: unknown): string {
  if (output === null || output === undefined) return 'no data';
  if (typeof output === 'object') return 'data';
  if (typeof output === 'string') return output;
  return JSON.stringify(output);
}

function shouldCreateSchedule(prompt: string): boolean {
  return /\b(schedule|book|set up|create)\b[\s\S]{0,80}\b(meeting|reminder|appointment|call)\b/i.test(
    prompt,
  );
}

/**
 * Heuristic: does the prompt ask the coworker to TAKE an action (needs tools /
 * the frontier loop) vs. just converse (advice, Q&A, drafting → local model)?
 * Conservative on the conversational side; the local model can still self-
 * escalate with ESCALATE for anything this misses.
 */
function isActionRequest(prompt: string): boolean {
  const p = prompt.trim();
  // Questions, advice, and pure drafting are conversational — unless they also
  // contain a hard action verb like send/deploy/delete.
  const conversational =
    /\b(how (?:do|can|should|would|might)|what (?:is|are|should|would)|why|when should|explain|describe|summari[sz]e|draft|write|compose|rewrite|reword|translate|brainstorm|ideas?|suggest|recommend|tips?|advice|review|analy[sz]e|compare|opinion|thoughts?|help me (?:understand|think|write|draft|decide))\b/i;
  const hardAction = /\b(send|deploy|delete|remove|schedule|book|pay|invoice|publish|launch|cancel)\b/i;
  if (conversational.test(p) && !hardAction.test(p)) return false;
  return /\b(create|add|update|edit|change|rename|move|assign|send|email|message|notify|schedule|book|remind|deploy|publish|launch|build|generate|run|execute|start|stop|pause|resume|cancel|pay|charge|invoice|refund|import|export|upload|connect|integrate|approve|reject|apply|set up|delete|remove)\b/i.test(
    p,
  );
}

/**
 * A question answerable from the org brief — a question word (or "do we have")
 * paired with an organizational noun (team, role, schedule, connected tool,
 * document). Conservative: ambiguous prompts fall through to the frontier.
 */
function isOrgKnowledgeQuestion(prompt: string): boolean {
  const p = prompt.trim();
  if (p.length > 280) return false;
  const asksQuestion =
    /\b(who|what|which|when|whose|how many|do we|does the|is there|are there|list)\b/i.test(
      p,
    );
  if (!asksQuestion) return false;
  return /\b(team|member|members|staff|role|roles|permission|permissions|who(?:'s| is)|report to|manager|schedule|scheduled|upcoming|meeting|meetings|appointment|connected|integration|integrations|tool|tools|document|documents|file|files|policy|policies)\b/i.test(
    p,
  );
}
