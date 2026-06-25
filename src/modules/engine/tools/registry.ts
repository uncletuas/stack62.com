import { Injectable } from '@nestjs/common';
import { EngineRuntimeService } from '../engine-runtime.service';
import { AutomationTools } from './automation.tools';
import { CalendarTools } from './calendar.tools';
import { CommunicationsTools } from './communications.tools';
import { MeetingsTools } from './meetings.tools';
import { MemoryTools } from './memory.tools';
import { OfficeTools } from './office.tools';
import { DataTools } from './data.tools';
import { DocumentsTools } from './documents.tools';
import { FileTools } from './file.tools';
import { IntegrationTools } from './integration.tools';
import { JobTools } from './job.tools';
import { PlanTools } from './plan.tools';
import { CommandTools } from './command.tools';
import { RunnerTools } from './runner.tools';
import { SchedulesTools } from './schedules.tools';
import { SystemTools } from './system.tools';
import { WebBrowsingTools } from './web-browsing.tools';
import { WorkspaceTools } from './workspace.tools';
import {
  type ToolContext,
  type ToolDefinition,
  type ToolHandlerResult,
} from './types';

/**
 * Anthropic requires tool names to match `^[a-zA-Z0-9_-]{1,128}$`. Internally
 * we use friendly dotted names like `systems.list`. We translate dots to
 * underscores at the API boundary and keep a reverse map for dispatch.
 */
function toExternal(name: string): string {
  return name.replace(/\./g, '_');
}

@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly externalToInternal = new Map<string, string>();

  constructor(
    private readonly data: DataTools,
    private readonly automation: AutomationTools,
    private readonly integrations: IntegrationTools,
    private readonly files: FileTools,
    private readonly documents: DocumentsTools,
    private readonly communications: CommunicationsTools,
    private readonly memory: MemoryTools,
    private readonly meetings: MeetingsTools,
    private readonly office: OfficeTools,
    private readonly calendar: CalendarTools,
    private readonly schedules: SchedulesTools,
    private readonly plans: PlanTools,
    private readonly jobs: JobTools,
    private readonly workspace: WorkspaceTools,
    private readonly systems: SystemTools,
    private readonly runner: RunnerTools,
    private readonly commands: CommandTools,
    private readonly webBrowsing: WebBrowsingTools,
    private readonly runtime: EngineRuntimeService,
  ) {
    this.register(this.workspace.build());
    this.register(this.data.build());
    this.register(this.automation.build());
    this.register(this.integrations.build());
    this.register(this.files.build());
    this.register(this.documents.build());
    this.register(this.communications.build());
    this.register(this.memory.build());
    this.register(this.meetings.build());
    this.register(this.office.build());
    this.register(this.calendar.build());
    this.register(this.schedules.build());
    this.register(this.systems.build());
    this.register(this.plans.build());
    this.register(this.jobs.build());
    this.register(this.runner.build());
    this.register(this.commands.build());
    this.register(this.webBrowsing.build());
  }

  private register(tools: ToolDefinition[]) {
    for (const t of tools) {
      this.tools.set(t.name, t);
      this.externalToInternal.set(toExternal(t.name), t.name);
    }
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Returns the Anthropic-style tool definitions to send to the model. */
  specs() {
    return this.list().map((t) => ({
      ...t.spec,
      name: toExternal(t.spec.name),
    }));
  }

  /**
   * Like `specs()`, but drops capability-gated tools the org can't use yet.
   * e.g. the email tool is hidden until a mailbox is connected, so the
   * Coworker doesn't offer to send mail it has no way to send. The caller
   * passes the precomputed capability flags (see EngineService).
   */
  specsGated(opts: {
    emailConnected: boolean;
    readOnly?: boolean;
    allowlist?: string[];
  }) {
    return this.list()
      .filter((t) =>
        t.requiresCapability === 'send_email' ? opts.emailConnected : true,
      )
      .filter((t) => (opts.readOnly ? this.isReadLike(t.name) : true))
      .filter((t) =>
        opts.allowlist && opts.allowlist.length
          ? opts.allowlist.some((prefix) => t.name.startsWith(prefix))
          : true,
      )
      .map((t) => ({ ...t.spec, name: toExternal(t.spec.name) }));
  }

  /** True when a tool is permitted under a read-only + allowlist scope. */
  isAllowed(
    name: string,
    opts: { readOnly?: boolean; allowlist?: string[] },
  ): boolean {
    const internal = this.externalToInternal.get(name) ?? name;
    if (opts.readOnly && !this.isReadLike(internal)) return false;
    if (opts.allowlist && opts.allowlist.length) {
      return opts.allowlist.some((prefix) => internal.startsWith(prefix));
    }
    return true;
  }

  has(name: string) {
    return this.tools.has(name) || this.externalToInternal.has(name);
  }

  /** Resolve a tool definition by internal dotted or external underscored name. */
  getDefinition(name: string): ToolDefinition | undefined {
    const internal = this.externalToInternal.get(name) ?? name;
    return this.tools.get(internal);
  }

  /**
   * A tool is "read-like" — safe to cache and replay — when it only reads
   * (actionLevel ≤ 1), isn't sensitive, and never needs confirmation. Replaying
   * such a tool re-executes it live, so the data stays fresh while skipping a
   * paid frontier call. Mutating/sending tools are never cached.
   */
  isReadLike(name: string): boolean {
    const tool = this.getDefinition(name);
    if (!tool) return false;
    if (tool.actionLevel && tool.actionLevel > 1) return false;
    if (tool.sensitive) return false;
    if (tool.requiresConfirmation) return false;
    return true;
  }

  /**
   * Dispatch a tool by either its internal dotted name or the external
   * underscored name returned by Anthropic.
   */
  async dispatch(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolHandlerResult> {
    const internal = this.externalToInternal.get(name) ?? name;
    const tool = this.tools.get(internal);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return this.runtime.execute({ tool, input, ctx });
  }

  /** Returns the friendly dotted name for an external (model-facing) name. */
  resolveName(externalOrInternal: string): string {
    return (
      this.externalToInternal.get(externalOrInternal) ?? externalOrInternal
    );
  }
}
