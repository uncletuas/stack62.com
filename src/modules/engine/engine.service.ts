import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CoworkerMemoryService } from '../coworker/coworker-memory.service';
import { CoworkerService } from '../coworker/coworker.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { AnthropicClient, type AnthropicMessage } from './anthropic.client';
import { CoworkerRuntimeService } from './coworker-runtime.service';
import {
  IntentClassifierService,
  type RouterTier,
} from './intent-classifier.service';
import { ToolRegistry } from './tools/registry';
import type { ToolContext } from './tools/types';

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

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly tools: ToolRegistry,
    private readonly organizationsService: OrganizationsService,
    private readonly coworkerRuntimeService: CoworkerRuntimeService,
    @Inject(forwardRef(() => CoworkerService))
    private readonly coworkerService: CoworkerService,
    @Inject(forwardRef(() => CoworkerMemoryService))
    private readonly coworkerMemoryService: CoworkerMemoryService,
    private readonly intentClassifier: IntentClassifierService,
  ) {}

  async *run(
    input: EngineSessionInput,
  ): AsyncGenerator<EngineEvent, void, void> {
    const sessionId = `eng-${Date.now().toString(36)}-${Math.random()
      .toString(16)
      .slice(2, 8)}`;
    const model = this.anthropic.resolveModel(input.model);
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
          message: 'A workspace is required before the coworker can build a system.',
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
            role: m.role as 'user' | 'assistant',
            content:
              typeof m.content === 'string'
                ? m.content
                : m.content
                    .map((b) => ('text' in b ? b.text : ''))
                    .join('\n'),
          })),
        tools: this.tools.list(),
      });
      yield {
        type: 'session.routed',
        tier: decision.tier,
        reason: decision.reason,
        tool: decision.tool?.name,
      };
      if (decision.tier === 0 && decision.directReply) {
        yield { type: 'message.complete', text: decision.directReply };
        yield { type: 'session.complete', turns: 0, stopReason: 'tier0_direct' };
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
            `Done. ${decision.tool.name} returned ${typeof result.output === 'object' ? 'data' : String(result.output)}.`;
          yield { type: 'message.complete', text: reply };
          yield {
            type: 'session.complete',
            turns: 1,
            stopReason: `tier${decision.tier}_tool`,
          };
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

    const system = [BASE_PROMPT, coworkerHint, input.systemHint]
      .filter(Boolean)
      .join('\n\n');

    const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
    let turns = 0;
    let stopReason = 'unknown';

    try {
      while (turns < maxTurns) {
        turns += 1;
        const completion = await this.anthropic.complete({
          model,
          system,
          messages,
          tools: this.tools.specs(),
          maxTokens: input.maxTokens,
          apiKey: orgKey,
        });

        const assistantContent = completion.content;
        messages.push({ role: 'assistant', content: assistantContent });
        stopReason = completion.stop_reason;

        const textBlocks = assistantContent.filter(
          (b): b is { type: 'text'; text: string } => b.type === 'text',
        );
        const text = textBlocks.map((b) => b.text).join('\n').trim();
        if (text) {
          yield { type: 'message.complete', text };
        }

        if (completion.stop_reason !== 'tool_use') {
          break;
        }

        const toolUses = assistantContent.filter(
          (b): b is {
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
          yield {
            type: 'tool.call',
            id: use.id,
            name: friendlyName,
            input: use.input,
          };
          try {
            const result = await this.tools.dispatch(use.name, use.input, input.ctx);
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
            const message =
              err instanceof Error ? err.message : 'Tool failed.';
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Engine session failed: ${message}`);
      yield { type: 'session.error', message };
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

function shouldCreateSchedule(prompt: string): boolean {
  return /\b(schedule|book|set up|create)\b[\s\S]{0,80}\b(meeting|reminder|appointment|call)\b/i.test(
    prompt,
  );
}
