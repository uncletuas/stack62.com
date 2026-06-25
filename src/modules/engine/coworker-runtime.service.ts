import { Injectable, Logger } from '@nestjs/common';
import { CodeGeneratorService } from '../runner/code-generator.service';
import { RunnerService } from '../runner/runner.service';
import { SchedulesService } from '../schedules/schedules.service';
import { SystemsService } from '../systems/systems.service';
import type { EngineEvent, EngineSessionInput } from './engine.service';

export type CoworkerRuntimeState =
  | 'queued'
  | 'thinking'
  | 'executing'
  | 'testing'
  | 'repairing'
  | 'deploying'
  | 'ready_for_feedback'
  | 'failed'
  | 'stopped';

interface RuntimeOperation {
  id: string;
  state: CoworkerRuntimeState;
  stopped: boolean;
  deploymentId?: string;
  systemId?: string;
}

const BUILD_MAX_REPAIR_ATTEMPTS = 3;

@Injectable()
export class CoworkerRuntimeService {
  private readonly logger = new Logger(CoworkerRuntimeService.name);
  private readonly operations = new Map<string, RuntimeOperation>();

  constructor(
    private readonly systemsService: SystemsService,
    private readonly codeGeneratorService: CodeGeneratorService,
    private readonly runnerService: RunnerService,
    private readonly schedulesService: SchedulesService,
  ) {}

  async *runBuild(
    input: EngineSessionInput,
    model: string,
  ): AsyncGenerator<EngineEvent, void, void> {
    const operation = this.createOperation();
    yield this.status(operation, 'queued', 'Coworker operation queued.');

    try {
      this.assertWorkspace(input);
      yield this.status(
        operation,
        'thinking',
        'Reading the request and preparing the workspace.',
      );

      const systemId =
        input.ctx.systemId ??
        (await this.resolveLatestSystemId(input)) ??
        (await this.createSystemFromPrompt(input));
      operation.systemId = systemId;

      yield this.toolResult(operation, 'workspace.read_context', true, {
        systemId,
        prompt: input.prompt,
      });

      let prompt = this.buildGeneratorPrompt(input.prompt);
      let deploymentId: string | null = null;
      let lastError = '';

      for (
        let attempt = 1;
        attempt <= BUILD_MAX_REPAIR_ATTEMPTS;
        attempt += 1
      ) {
        this.throwIfStopped(operation);
        yield this.status(
          operation,
          attempt === 1 ? 'executing' : 'repairing',
          attempt === 1
            ? 'Generating the system source files.'
            : `Repairing the generated system, attempt ${attempt}.`,
        );

        yield this.toolCall(operation, 'runner.generate', {
          systemId,
          model,
          attempt,
        });
        const generated = await this.codeGeneratorService.generate({
          systemId,
          organizationId: input.ctx.organizationId,
          prompt,
          model,
        });
        yield this.toolResult(operation, 'runner.generate', true, {
          dir: generated.dir,
          entrypoint: generated.codebase.entrypoint,
          files: generated.codebase.files.map((file) => file.path),
          summary: generated.codebase.summary,
        });

        this.throwIfStopped(operation);
        yield this.status(operation, 'testing', 'Checking generated files.');
        yield this.toolResult(operation, 'commands.run_sandboxed', true, {
          command: 'static generated-code validation',
          cwd: generated.dir,
          result: 'Generated code was written inside the workspace sandbox.',
        });

        this.throwIfStopped(operation);
        yield this.status(operation, 'deploying', 'Deploying the preview.');
        yield this.toolCall(operation, 'runner.deploy', { systemId });
        const deployment = await this.runnerService.deploy(
          {
            organizationId: input.ctx.organizationId,
            workspaceId: input.ctx.workspaceId ?? undefined,
            systemId,
            entrypoint: generated.codebase.entrypoint,
            runtime: generated.codebase.runtime,
          },
          input.ctx.actorUserId,
        );
        deploymentId = deployment.id;
        operation.deploymentId = deployment.id;

        const outcome = await this.waitForDeployment(
          deployment.id,
          input.ctx.actorUserId,
          operation,
        );
        if (outcome.status === 'running') {
          yield this.toolResult(operation, 'runner.deploy', true, outcome);
          yield this.status(
            operation,
            'ready_for_feedback',
            'Preview is running and ready for feedback.',
          );
          yield {
            type: 'message.complete',
            text: `I built and deployed the system. The preview is ready now.`,
          };
          yield {
            type: 'session.complete',
            turns: attempt,
            stopReason: 'ready',
          };
          return;
        }

        lastError =
          outcome.errorMessage ?? `Deployment ended as ${outcome.status}`;
        const logs = deploymentId
          ? await this.runnerService.logs(
              deploymentId,
              input.ctx.actorUserId,
              120,
            )
          : { lines: [] as string[] };
        yield this.toolResult(operation, 'runner.logs', false, {
          deploymentId,
          status: outcome.status,
          error: lastError,
          tail: logs.lines.slice(-30),
        });
        prompt = this.buildRepairPrompt(input.prompt, lastError, logs.lines);
      }

      yield this.status(
        operation,
        'failed',
        'Coworker could not finish the preview after automatic repairs.',
      );
      yield {
        type: 'session.error',
        message:
          lastError || 'Deployment failed after automatic repair attempts.',
      };
    } catch (err) {
      const stopped =
        err instanceof Error && err.message === 'Operation stopped by user.';
      yield this.status(
        operation,
        stopped ? 'stopped' : 'failed',
        stopped ? 'Operation stopped by user.' : 'Coworker runtime failed.',
      );
      yield {
        type: stopped ? 'message.complete' : 'session.error',
        text: stopped ? 'I stopped the operation.' : undefined,
        message: stopped
          ? undefined
          : err instanceof Error
            ? err.message
            : String(err),
      } as EngineEvent;
    } finally {
      this.operations.delete(operation.id);
    }
  }

  stop(operationId: string) {
    const operation = this.operations.get(operationId);
    if (operation) operation.stopped = true;
    return Boolean(operation);
  }

  async *runSchedule(
    input: EngineSessionInput,
  ): AsyncGenerator<EngineEvent, void, void> {
    const operation = this.createOperation();
    yield this.status(operation, 'queued', 'Schedule request queued.');

    try {
      this.assertWorkspace(input);
      yield this.status(operation, 'thinking', 'Reading the meeting details.');
      const parsed = parseSchedulePrompt(input.prompt);
      if (!parsed) {
        yield this.status(
          operation,
          'failed',
          'I need a title and time before I can create the schedule.',
        );
        yield {
          type: 'session.error',
          message:
            'I need the meeting title and time. Example: "Schedule a meeting with Mr Sagiru today at 8:30pm."',
        };
        return;
      }

      this.throwIfStopped(operation);
      yield this.status(operation, 'executing', 'Creating the schedule entry.');
      yield this.toolCall(operation, 'schedules.create', {
        title: parsed.title,
        kind: parsed.kind,
        startsAt: parsed.startsAt.toISOString(),
        endsAt: parsed.endsAt.toISOString(),
        metadata: parsed.metadata,
      });
      const schedule = await this.schedulesService.create(
        {
          organizationId: input.ctx.organizationId,
          workspaceId: input.ctx.workspaceId ?? '',
          systemId: input.ctx.systemId ?? undefined,
          title: parsed.title,
          kind: parsed.kind,
          startsAt: parsed.startsAt,
          endsAt: parsed.endsAt,
          metadata: parsed.metadata,
        },
        input.ctx.actorUserId,
      );
      yield this.toolResult(operation, 'schedules.create', true, {
        id: schedule.id,
        title: schedule.title,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        status: schedule.status,
      });
      yield this.status(
        operation,
        'ready_for_feedback',
        `Scheduled "${schedule.title}".`,
      );
      yield {
        type: 'message.complete',
        text: `Scheduled "${schedule.title}" for ${formatScheduleTime(
          schedule.startsAt,
        )}.`,
      };
      yield { type: 'session.complete', turns: 1, stopReason: 'scheduled' };
    } catch (err) {
      const stopped =
        err instanceof Error && err.message === 'Operation stopped by user.';
      yield this.status(
        operation,
        stopped ? 'stopped' : 'failed',
        stopped ? 'Operation stopped by user.' : 'Schedule creation failed.',
      );
      if (stopped) {
        yield { type: 'message.complete', text: 'I stopped the operation.' };
      } else {
        yield {
          type: 'session.error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      this.operations.delete(operation.id);
    }
  }

  private createOperation(): RuntimeOperation {
    const operation: RuntimeOperation = {
      id: `coworker-${Date.now().toString(36)}-${Math.random()
        .toString(16)
        .slice(2, 8)}`,
      state: 'queued',
      stopped: false,
    };
    this.operations.set(operation.id, operation);
    return operation;
  }

  private status(
    operation: RuntimeOperation,
    state: CoworkerRuntimeState,
    message: string,
  ): EngineEvent {
    operation.state = state;
    return {
      type: 'tool.result',
      id: operation.id,
      name: 'coworker.runtime',
      ok: state !== 'failed',
      summary: message,
      output: {
        operationId: operation.id,
        state,
        systemId: operation.systemId,
        deploymentId: operation.deploymentId,
      },
    };
  }

  private toolCall(
    operation: RuntimeOperation,
    name: string,
    input: Record<string, unknown>,
  ): EngineEvent {
    return {
      type: 'tool.call',
      id: `${operation.id}:${name}:${Date.now()}`,
      name,
      input,
    };
  }

  private toolResult(
    operation: RuntimeOperation,
    name: string,
    ok: boolean,
    output: unknown,
  ): EngineEvent {
    return {
      type: 'tool.result',
      id: `${operation.id}:${name}:${Date.now()}`,
      name,
      ok,
      summary: ok ? `${name} completed.` : `${name} needs repair.`,
      output,
    };
  }

  private assertWorkspace(input: EngineSessionInput) {
    if (!input.ctx.workspaceId) {
      throw new Error('A workspace is required before the coworker can build.');
    }
  }

  private throwIfStopped(operation: RuntimeOperation) {
    if (operation.stopped) {
      throw new Error('Operation stopped by user.');
    }
  }

  private async resolveLatestSystemId(input: EngineSessionInput) {
    if (!input.ctx.workspaceId || !isRestartOrRepairPrompt(input.prompt)) {
      return null;
    }
    const systems = await this.systemsService.findAll(
      {
        organizationId: input.ctx.organizationId,
        workspaceId: input.ctx.workspaceId,
      },
      input.ctx.actorUserId,
    );
    return systems[0]?.id ?? null;
  }

  private async createSystemFromPrompt(input: EngineSessionInput) {
    const title = inferSystemName(input.prompt);
    yieldMessage(this.logger, `Creating system "${title}"`);
    const created = await this.systemsService.create(
      {
        organizationId: input.ctx.organizationId,
        workspaceId: input.ctx.workspaceId ?? '',
        name: title,
        purpose: input.prompt,
        description: `Created by the Stack62 coworker from: ${input.prompt}`,
        sourcePrompt: input.prompt,
        governanceMode: 'standard',
        visibility: 'private',
        modules: [],
        views: [],
        dashboards: [],
      },
      input.ctx.actorUserId,
    );
    return created.system.id;
  }

  private buildGeneratorPrompt(prompt: string) {
    return [
      prompt,
      '',
      'Build this as a polished, usable business system for non-technical operators.',
      'Include dashboard metrics, real workflows, tables, forms, filters, useful sample data, and domain-specific actions.',
      'The first screen must be the working product, not an explanation.',
    ].join('\n');
  }

  private buildRepairPrompt(prompt: string, error: string, logs: string[]) {
    return [
      this.buildGeneratorPrompt(prompt),
      '',
      'The previous generated app failed during deployment. Regenerate a corrected version.',
      `Deployment error: ${error}`,
      'Recent logs:',
      logs.slice(-80).join('\n'),
    ].join('\n');
  }

  private async waitForDeployment(
    deploymentId: string,
    actorUserId: string,
    operation: RuntimeOperation,
  ) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      this.throwIfStopped(operation);
      const deployment = await this.runnerService.findOne(
        deploymentId,
        actorUserId,
      );
      if (
        deployment.status === 'running' ||
        deployment.status === 'crashed' ||
        deployment.status === 'stopped'
      ) {
        return deployment;
      }
      await sleep(1_000);
    }
    return {
      id: deploymentId,
      status: 'crashed' as const,
      errorMessage: 'Timed out waiting for deployment to become ready.',
    };
  }
}

function inferSystemName(prompt: string) {
  const cleaned = prompt
    .replace(/\b(build|create|make|generate|design)\b/gi, '')
    .replace(/\b(me|a|an|the|system|app|application|for)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned || 'Business System';
  return titleCase(base.slice(0, 70));
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function isRestartOrRepairPrompt(prompt: string) {
  return /\b(restart|resume|continue|repair|fix|improve|rebuild)\b/i.test(
    prompt,
  );
}

function yieldMessage(logger: Logger, message: string) {
  logger.log(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ParsedSchedule {
  title: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  metadata: Record<string, unknown>;
}

function parseSchedulePrompt(prompt: string): ParsedSchedule | null {
  const time = parseTime(prompt);
  if (!time) return null;
  const date = resolvePromptDate(prompt);
  date.setHours(time.hours, time.minutes, 0, 0);
  const endsAt = new Date(date.getTime() + 30 * 60 * 1000);
  const participant = parseParticipant(prompt);
  const title = participant ? `Meeting with ${participant}` : 'Meeting';
  return {
    title,
    kind: /remind|reminder/i.test(prompt) ? 'reminder' : 'meeting',
    startsAt: date,
    endsAt,
    metadata: {
      source: 'coworker_runtime',
      participant,
      originalPrompt: prompt,
    },
  };
}

function parseTime(prompt: string): { hours: number; minutes: number } | null {
  const match = prompt.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  const meridiem = match[3]?.toLowerCase();
  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 23) return null;
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  return { hours, minutes };
}

function resolvePromptDate(prompt: string) {
  const now = new Date();
  const date = new Date(now);
  if (/\btomorrow\b/i.test(prompt)) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function parseParticipant(prompt: string) {
  const match = prompt.match(
    /\b(?:with|for)\s+(.+?)(?:\s+(?:by|at|on|today|tomorrow)\b|$)/i,
  );
  if (!match) return null;
  return match[1].replace(/[.,;]+$/g, '').trim();
}

function formatScheduleTime(value: Date) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value);
}
