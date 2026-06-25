import { BadRequestException, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { tool, type ToolDefinition } from './types';

const ALLOWED_COMMANDS = new Set([
  'npm install',
  'npm run build',
  'npm run test',
  'npm test',
  'npm run lint',
  'npm run typecheck',
  'node',
]);

const DENIED_PATTERN =
  /\b(rm|del|erase|format|shutdown|restart-computer|powershell|cmd|curl|wget|scp|ssh|git\s+push|git\s+reset|mklink)\b/i;

@Injectable()
export class CommandTools {
  private readonly generatedRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.generatedRoot = path.resolve(
      this.configService.get<string>(
        'GENERATED_SYSTEMS_ROOT',
        'generated/systems',
      ),
    );
  }

  build(): ToolDefinition[] {
    return [
      tool(
        'commands.run_sandboxed',
        'Run an allowed command inside the generated systems workspace sandbox.',
        {
          properties: {
            cwd: { type: 'string' },
            command: { type: 'string' },
            timeoutMs: { type: 'number' },
          },
          required: ['cwd', 'command'],
        },
        async (input) => {
          const cwd = this.validateSandboxCommand(
            String(input.cwd),
            String(input.command ?? '').trim(),
          ).cwd;
          const command = String(input.command ?? '').trim();
          const result = await this.runCommand(
            command,
            cwd,
            typeof input.timeoutMs === 'number' ? input.timeoutMs : 60_000,
          );
          return {
            output: result,
            summary:
              result.code === 0
                ? `Command completed: ${command}`
                : `Command failed (${result.code}): ${command}`,
          };
        },
      ),
    ];
  }

  validateSandboxCommand(cwd: string, command: string) {
    const resolvedCwd = this.resolveSandboxCwd(cwd);
    this.assertAllowedCommand(command);
    return { cwd: resolvedCwd, command };
  }

  private resolveSandboxCwd(cwd: string) {
    if (!cwd || cwd.includes('\0')) {
      throw new BadRequestException('Invalid command cwd.');
    }
    const abs = path.resolve(cwd);
    const root = this.generatedRoot + path.sep;
    if (abs !== this.generatedRoot && !abs.startsWith(root)) {
      throw new BadRequestException(
        'Commands can only run inside the generated systems sandbox.',
      );
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw new BadRequestException('Command cwd does not exist.');
    }
    return abs;
  }

  private assertAllowedCommand(command: string) {
    if (!command || DENIED_PATTERN.test(command)) {
      throw new BadRequestException('Command is not allowed in the sandbox.');
    }
    const normalized = command.replace(/\s+/g, ' ').trim();
    const allowed =
      ALLOWED_COMMANDS.has(normalized) ||
      [...ALLOWED_COMMANDS].some((prefix) =>
        normalized.startsWith(`${prefix} `),
      );
    if (!allowed) {
      throw new BadRequestException(
        `Command is not on the allowed sandbox command list: ${normalized}`,
      );
    }
  }

  private runCommand(command: string, cwd: string, timeoutMs: number) {
    return new Promise<{
      command: string;
      cwd: string;
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const [cmd, ...args] = command.split(/\s+/);
      const child = spawn(
        process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd,
        args,
        {
          cwd,
          env: this.buildChildEnv(),
          windowsHide: true,
        },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new BadRequestException(`Command timed out after ${timeoutMs}ms.`),
        );
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        stdout = stdout.slice(-32_000);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        stderr = stderr.slice(-32_000);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ command, cwd, code, stdout, stderr });
      });
    });
  }

  private buildChildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    return env;
  }
}
