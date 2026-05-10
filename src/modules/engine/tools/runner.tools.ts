import { Injectable } from '@nestjs/common';
import { CodeGeneratorService } from '../../runner/code-generator.service';
import { RunnerService } from '../../runner/runner.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class RunnerTools {
  constructor(
    private readonly codeGeneratorService: CodeGeneratorService,
    private readonly runnerService: RunnerService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'runner.generate',
        'Generate or regenerate source code for a Stack62 system.',
        {
          properties: {
            systemId: { type: 'string' },
            prompt: { type: 'string' },
            model: { type: 'string' },
          },
          required: ['systemId', 'prompt'],
        },
        async (input, ctx) => {
          const result = await this.codeGeneratorService.generate({
            systemId: String(input.systemId),
            organizationId: ctx.organizationId,
            prompt: String(input.prompt),
            model: typeof input.model === 'string' ? input.model : undefined,
          });
          return {
            output: {
              dir: result.dir,
              summary: result.codebase.summary,
              entrypoint: result.codebase.entrypoint,
              runtime: result.codebase.runtime,
              files: result.codebase.files.map((file) => file.path),
            },
            summary: result.codebase.summary,
          };
        },
      ),
      tool(
        'runner.deploy',
        'Deploy a generated system preview.',
        {
          properties: {
            systemId: { type: 'string' },
            entrypoint: { type: 'string' },
            runtime: { type: 'string' },
          },
          required: ['systemId'],
        },
        async (input, ctx) => {
          const deployment = await this.runnerService.deploy(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              systemId: String(input.systemId),
              entrypoint:
                typeof input.entrypoint === 'string'
                  ? input.entrypoint
                  : undefined,
              runtime:
                typeof input.runtime === 'string' ? input.runtime : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: deployment,
            summary: `Deployment ${deployment.id.slice(0, 8)} queued.`,
          };
        },
      ),
      tool(
        'runner.logs',
        'Read deployment logs for repair and debugging.',
        {
          properties: {
            deploymentId: { type: 'string' },
            tail: { type: 'number' },
          },
          required: ['deploymentId'],
        },
        async (input, ctx) => {
          const logs = await this.runnerService.logs(
            String(input.deploymentId),
            ctx.actorUserId,
            typeof input.tail === 'number' ? input.tail : 200,
          );
          return {
            output: logs,
            summary: `${logs.lines.length} log line(s).`,
          };
        },
      ),
      tool(
        'runner.stop',
        'Stop a running deployment preview.',
        {
          properties: {
            deploymentId: { type: 'string' },
          },
          required: ['deploymentId'],
        },
        async (input, ctx) => {
          const deployment = await this.runnerService.stop(
            String(input.deploymentId),
            ctx.actorUserId,
          );
          return {
            output: deployment,
            summary: `Stopped deployment ${deployment.id.slice(0, 8)}.`,
          };
        },
      ),
      tool(
        'browser.preview_check',
        'Check whether a deployed preview is ready to open.',
        {
          properties: {
            deploymentId: { type: 'string' },
          },
          required: ['deploymentId'],
        },
        async (input, ctx) => {
          const deployment = await this.runnerService.findOne(
            String(input.deploymentId),
            ctx.actorUserId,
          );
          return {
            output: {
              deploymentId: deployment.id,
              status: deployment.status,
              ready: deployment.status === 'running',
              proxyPath:
                deployment.status === 'running'
                  ? `/sys/${deployment.id}/`
                  : null,
              errorMessage: deployment.errorMessage,
            },
            summary:
              deployment.status === 'running'
                ? 'Preview is ready.'
                : `Preview is ${deployment.status}.`,
          };
        },
      ),
    ];
  }
}
