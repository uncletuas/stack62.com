import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaClient } from './ollama.client';
import type { ToolDefinition } from './tools/types';

export type RouterTier = 0 | 1 | 2 | 3;

export interface ClassifierResult {
  tier: RouterTier;
  /** When tier 0 or 1 picked a tool, the tool name + parsed input. */
  tool?: { name: string; input: Record<string, unknown> };
  /** When tier 0 has a canned reply (no tool), the text to return directly. */
  directReply?: string;
  /** Why this tier was chosen — surfaced in logs and the UI badge. */
  reason: string;
}

/**
 * Tier 0 — deterministic intent recognition. Patterns map free-text prompts
 * directly to a single typed tool call without any LLM. Only patterns where
 * we are *highly confident* in both intent and parameter extraction belong
 * here. When in doubt, return null and let Tier 1+ handle it.
 *
 * Each rule's `match` returns either a tool call to run, a direct reply, or
 * null to skip. Order matters — first match wins.
 */
type Tier0Rule = {
  id: string;
  match: (
    prompt: string,
  ) =>
    | { tool: { name: string; input: Record<string, unknown> }; reason: string }
    | { directReply: string; reason: string }
    | null;
};

const TIER0_RULES: Tier0Rule[] = [
  // Read-only listing intents.
  {
    id: 'list_pending_plans',
    match: (p) =>
      /\b(pending|waiting|to (?:approve|review))\b.*\b(plan|change|request)s?\b/i.test(
        p,
      ) || /\b(show|list|what(?:'s| is)?)\b.*\bplans?\b/i.test(p)
        ? {
            tool: { name: 'plans.list', input: { status: 'pending' } },
            reason: 'list pending plans',
          }
        : null,
  },
  {
    id: 'list_systems',
    match: (p) =>
      /\b(list|show|what(?:'s| are)?)\b.*\b(my )?systems?\b/i.test(p)
        ? { tool: { name: 'systems.list', input: {} }, reason: 'list systems' }
        : null,
  },
  {
    id: 'list_workflows',
    match: (p) =>
      /\b(list|show)\b.*\bworkflows?\b/i.test(p)
        ? {
            tool: { name: 'workflows.list', input: {} },
            reason: 'list workflows',
          }
        : null,
  },
  {
    id: 'list_tasks',
    match: (p) =>
      /\b(list|show|what)\b.*\b(my |open |pending )?tasks?\b/i.test(p)
        ? { tool: { name: 'tasks.list', input: {} }, reason: 'list tasks' }
        : null,
  },
  {
    id: 'list_documents',
    match: (p) =>
      /\b(list|show)\b.*\bdocuments?\b/i.test(p)
        ? {
            tool: { name: 'documents.list', input: {} },
            reason: 'list documents',
          }
        : null,
  },
  {
    id: 'list_files',
    match: (p) =>
      /\b(list|show)\b.*\bfiles?\b/i.test(p)
        ? { tool: { name: 'files.list', input: {} }, reason: 'list files' }
        : null,
  },
  {
    id: 'list_jobs',
    match: (p) =>
      /\b(list|show|what(?:'s| are)?)\b.*\b(running |scheduled |my )?jobs?\b/i.test(
        p,
      )
        ? { tool: { name: 'jobs.list', input: {} }, reason: 'list jobs' }
        : null,
  },
  {
    id: 'list_integrations',
    match: (p) =>
      /\b(list|show|what)\b.*\b(connected |my )?(integrations?|tools?|connections?)\b/i.test(
        p,
      )
        ? {
            tool: { name: 'integrations.list', input: {} },
            reason: 'list connected integrations',
          }
        : null,
  },
  {
    id: 'list_schedules',
    match: (p) =>
      /\b(list|show|what(?:'s)?)\b.*\b(scheduled|schedules?|upcoming|on (?:the |my )?calendar|next)\b/i.test(
        p,
      )
        ? {
            tool: { name: 'schedules.list', input: {} },
            reason: 'list schedules',
          }
        : null,
  },
  {
    id: 'list_reports',
    match: (p) =>
      /\b(list|show)\b.*\breports?\b/i.test(p)
        ? { tool: { name: 'reports.list', input: {} }, reason: 'list reports' }
        : null,
  },
  {
    id: 'list_meetings',
    match: (p) =>
      /\b(list|show)\b.*\bmeetings?\b/i.test(p)
        ? {
            tool: { name: 'meetings.list', input: {} },
            reason: 'list meetings',
          }
        : null,
  },
  // Search.
  {
    id: 'search_workspace',
    match: (p) => {
      const m =
        /\b(search|find|look (?:for|up))\b\s+(?:for\s+)?["']?(.+?)["']?$/i.exec(
          p.trim(),
        );
      if (!m) return null;
      const q = m[2]?.trim();
      if (!q || q.length < 2 || q.length > 200) return null;
      return {
        tool: { name: 'workspace.search', input: { query: q } },
        reason: 'workspace search',
      };
    },
  },
  // Greetings — direct replies, no LLM.
  {
    id: 'greet',
    match: (p) =>
      /^\s*(hi|hello|hey|yo|howdy|good (?:morning|afternoon|evening))\s*[!.?]?\s*$/i.test(
        p,
      )
        ? {
            directReply:
              "Hi! I'm here. Tell me what you'd like to do — list pending plans, search the workspace, draft a doc, anything.",
            reason: 'greeting',
          }
        : null,
  },
  {
    id: 'thanks',
    match: (p) =>
      /^\s*(thanks?|thank you|ty|cheers)\s*[!.?]?\s*$/i.test(p)
        ? { directReply: 'You got it.', reason: 'thanks' }
        : null,
  },
  // "What can you do" → static answer. Kept narrow so real requests like
  // "help me write an email" or "what are 3 ways to…" are NOT caught here.
  {
    id: 'capabilities',
    match: (p) =>
      /^\s*(what can you do|how can you help( me)?|what are your capabilities)\s*\??\s*$/i.test(
        p,
      )
        ? {
            directReply:
              "I can search the workspace, list and act on records, tasks, schedules, plans, files and documents, run connected tools (Gmail, WhatsApp, QuickBooks, Drive, Calendar), and propose changes through the Plan → Diff → Approve flow. Tell me a goal and I'll pick the right path.",
            reason: 'capabilities',
          }
        : null,
  },
];

@Injectable()
export class IntentClassifierService {
  private readonly logger = new Logger(IntentClassifierService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly ollama: OllamaClient,
  ) {}

  /**
   * Classify the user prompt into a router tier.
   *
   * - Tier 0 (deterministic): a regex/rule produced a confident tool call
   *   or a static direct reply. Latency: <1ms. Cost: $0.
   * - Tier 1 (local small model): Ollama produced a single tool call we can
   *   execute without escalation. Free, on-prem.
   * - Tier 2/3 (cloud LLM): no confident local match — escalate.
   *
   * The engine never *requires* this method to succeed; it's strictly an
   * accelerator. Failures escalate cleanly to Tier 3.
   */
  async classify(input: {
    prompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    tools: ToolDefinition[];
  }): Promise<ClassifierResult> {
    const enabled = this.configService.get<string>('STACK62_ROUTER_ENABLED');
    if (enabled === 'false' || enabled === '0') {
      return { tier: 3, reason: 'router disabled' };
    }

    // Tier 0 — deterministic rules.
    const tier0 = this.tryTier0(input.prompt, input.tools);
    if (tier0) return tier0;

    // Tier 1 (generative) — low-level text work the local model can do well
    // on its own: summarize / rewrite / translate / draft from inline content.
    // These are often long-form (they carry the content), so this runs BEFORE
    // the long-form escalation gate below.
    const genIntent = detectGenerativeIntent(input.prompt);
    if (genIntent) {
      const ollamaReady = await this.ollama.isAvailable();
      if (ollamaReady) {
        try {
          const reply = await this.tryTier1Generative(input.prompt, genIntent);
          if (reply) {
            return {
              tier: 1,
              directReply: reply,
              reason: `local ${genIntent} (no API)`,
            };
          }
        } catch (err) {
          this.logger.warn(
            `Tier-1 generative failed, escalating: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    // Tier 1 (tool triage) — local small model picks one read/search tool.
    // Skip when the prompt is long-form or the history is deep enough to
    // suggest agentic planning.
    const longForm = input.prompt.split(/\s+/).length > 60;
    const deepThread = input.history.length > 8;
    if (longForm || deepThread) {
      return {
        tier: 3,
        reason: longForm ? 'long-form prompt' : 'deep thread',
      };
    }

    const ollamaReady = await this.ollama.isAvailable();
    if (!ollamaReady) {
      return { tier: 3, reason: 'local model unavailable' };
    }

    try {
      const tier1 = await this.tryTier1(input);
      if (tier1) return tier1;
    } catch (err) {
      this.logger.warn(
        `Tier-1 classifier failed, escalating: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { tier: 3, reason: 'no confident local match' };
  }

  /**
   * Run a self-contained generative task on the local model. Only used for
   * low-level text transforms where the content is supplied inline, so no
   * workspace context or tools are needed — and no frontier call.
   */
  private async tryTier1Generative(
    prompt: string,
    intent: string,
  ): Promise<string | null> {
    const reply = await this.ollama.complete([
      {
        role: 'system',
        content:
          `You are Stack62's local assistant handling a ${intent} task. ` +
          'Do exactly what the user asks with the text they provide. Return only ' +
          'the result — no preamble, no meta-commentary. If the request actually ' +
          'needs data you were not given, reply with the single token NEED_CONTEXT.',
      },
      { role: 'user', content: prompt },
    ]);
    const trimmed = reply.trim();
    if (
      !trimmed ||
      trimmed === 'NEED_CONTEXT' ||
      trimmed.includes('NEED_CONTEXT')
    ) {
      return null;
    }
    return trimmed;
  }

  private tryTier0(
    prompt: string,
    tools: ToolDefinition[],
  ): ClassifierResult | null {
    const toolNames = new Set(tools.map((t) => t.name));
    for (const rule of TIER0_RULES) {
      const hit = rule.match(prompt);
      if (!hit) continue;
      if ('directReply' in hit) {
        return { tier: 0, directReply: hit.directReply, reason: hit.reason };
      }
      if (!toolNames.has(hit.tool.name)) continue; // tool gone — skip
      return { tier: 0, tool: hit.tool, reason: hit.reason };
    }
    return null;
  }

  private async tryTier1(input: {
    prompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    tools: ToolDefinition[];
  }): Promise<ClassifierResult | null> {
    // Only expose read/list-class tools to the small model. Sensitive or
    // mutating tools require Tier-3 reasoning so we don't accidentally let a
    // small model send an email.
    const safeTools = input.tools.filter((t) => isReadLikeTool(t));
    if (safeTools.length === 0) return null;

    const plan = await this.ollama.planToolCall({
      system:
        'You are a fast triage layer. Pick the single most appropriate read/search tool for the user prompt. If no tool fits or the request is ambiguous, set "tool" to null and let the higher-tier model handle it.',
      history: input.history.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      prompt: input.prompt,
      tools: safeTools.map((t) => ({
        name: t.spec.name,
        description: t.spec.description,
        input_schema: t.spec.input_schema,
      })),
    });

    if (!plan.tool) {
      // Local model declined; escalate.
      return null;
    }
    const matched = safeTools.find((t) => t.name === plan.tool!.name);
    if (!matched) return null;
    return {
      tier: 1,
      tool: { name: matched.name, input: plan.tool.input ?? {} },
      reason: 'local-model intent match',
    };
  }
}

/**
 * Detect a self-contained, low-level generative task the local model can do
 * without any workspace data. Requires both a generative verb AND enough
 * inline content (so "draft an email to the team" — which needs org context —
 * doesn't match, but "summarize: <long text>" does). Returns the intent label
 * or null.
 */
function detectGenerativeIntent(prompt: string): string | null {
  const p = prompt.trim();
  const wordCount = p.split(/\s+/).length;
  const hasInlineContent = wordCount >= 12 || /[:\n"“]/.test(p);
  if (!hasInlineContent) return null;
  const verbs: Array<[RegExp, string]> = [
    [/\b(summari[sz]e|tl;?dr|give me the gist|key points)\b/i, 'summarize'],
    [
      /\b(rewrite|rephrase|paraphrase|reword|make this (?:more )?(?:formal|casual|concise|polite)|improve the wording)\b/i,
      'rewrite',
    ],
    [/\b(translate|translation)\b/i, 'translate'],
    [
      /\b(proofread|fix (?:the )?grammar|correct the grammar|fix typos)\b/i,
      'proofread',
    ],
    [/\b(shorten|condense|trim this down)\b/i, 'shorten'],
    [/\b(expand|elaborate on|flesh out)\b/i, 'expand'],
    [/\b(classify|categori[sz]e|what category|sentiment of)\b/i, 'classify'],
    [/\b(extract|pull out|list the)\b.*\b(from|in)\b/i, 'extract'],
    [/\b(bullet points?|turn .* into bullets)\b/i, 'reformat'],
  ];
  for (const [re, label] of verbs) {
    if (re.test(p)) return label;
  }
  return null;
}

function isReadLikeTool(t: ToolDefinition): boolean {
  if (t.actionLevel && t.actionLevel >= 3) return false;
  if (t.sensitive) return false;
  if (t.requiresConfirmation) return false;
  // Verbs we trust as read-only.
  const verb = t.name.split('.')[1] ?? '';
  return ['list', 'search', 'read', 'get', 'find', 'count'].includes(verb);
}
