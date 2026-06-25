import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Dev/test provider for running Stack62 AI through the local Codex CLI.
 *
 * This is intentionally a test-mode bridge, not the production API path. It
 * relies on the backend host having `codex` installed and authenticated with:
 *   codex login
 *
 * Model routing: `codex:<model>` routes here, e.g. `codex:gpt-5.1-codex`.
 */
@Injectable()
export class CodexService {
  private readonly logger = new Logger(CodexService.name);
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private availabilityCache: {
    available: boolean;
    version: string | null;
    checkedAt: number;
  } | null = null;

  constructor(private readonly configService: ConfigService) {
    this.binary = this.configService.get<string>(
      'CODEX_BIN',
      CodexService.resolveDefaultBinary(),
    );
    this.timeoutMs = Number(
      this.configService.get<number>('CODEX_TIMEOUT_MS', 180_000),
    );
    this.maxBytes = Number(
      this.configService.get<number>('CODEX_MAX_BYTES', 4 * 1024 * 1024),
    );
  }

  static parseModel(model: string | null | undefined): string | null {
    if (!model) return null;
    if (model === 'codex') return '';
    if (model.startsWith('codex:')) {
      return model.slice('codex:'.length);
    }
    return null;
  }

  private static resolveDefaultBinary(): string {
    if (process.platform !== 'win32') return 'codex';
    const npmRoot = process.env.APPDATA
      ? resolve(process.env.APPDATA, 'npm')
      : null;
    const userProfile = process.env.USERPROFILE ?? null;
    const vscodeExtensionRoot = userProfile
      ? resolve(userProfile, '.vscode', 'extensions')
      : null;
    const candidates = [
      npmRoot ? resolve(npmRoot, 'codex.exe') : null,
      npmRoot ? resolve(npmRoot, 'codex.cmd') : null,
      ...CodexService.findVsCodeCodexBinaries(vscodeExtensionRoot),
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return 'codex.cmd';
  }

  private static findVsCodeCodexBinaries(root: string | null): string[] {
    if (!root || !existsSync(root)) return [];
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'),
        )
        .map((entry) =>
          resolve(root, entry.name, 'bin', 'windows-x86_64', 'codex.exe'),
        )
        .filter((path) => existsSync(path))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<{ available: boolean; version: string | null }> {
    const now = Date.now();
    if (
      this.availabilityCache &&
      now - this.availabilityCache.checkedAt < 60_000
    ) {
      return {
        available: this.availabilityCache.available,
        version: this.availabilityCache.version,
      };
    }

    try {
      const { stdout, code } = await this.runProcess(
        [this.binary, '--version'],
        '',
        { timeoutMs: 5_000 },
      );
      if (code === 0) {
        const version = stdout.trim().split(/\s+/)[0] || null;
        this.availabilityCache = { available: true, version, checkedAt: now };
        return { available: true, version };
      }
    } catch (err) {
      this.logger.debug(
        `codex CLI not available: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.availabilityCache = {
      available: false,
      version: null,
      checkedAt: now,
    };
    return { available: false, version: null };
  }

  async complete(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    model: string | null,
  ): Promise<string> {
    const { available } = await this.isAvailable();
    if (!available) {
      throw new Error(
        'Codex CLI is not available on this host. Install Codex and run `codex login`.',
      );
    }

    const prompt = this.packPrompt(messages);
    const outFile = join(
      tmpdir(),
      `stack62-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    );

    const args = [
      this.binary,
      'exec',
      '-',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--output-last-message',
      outFile,
      '--color',
      'never',
      '-C',
      tmpdir(),
    ];

    if (model) args.push('--model', model);

    const { stdout, stderr, code } = await this.runProcess(args, prompt, {
      timeoutMs: this.timeoutMs,
    });

    if (code !== 0) {
      throw new Error(
        `Codex CLI exited ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`,
      );
    }

    try {
      const result = await readFile(outFile, 'utf8');
      return result.trim() || stdout.trim();
    } finally {
      await unlink(outFile).catch(() => undefined);
    }
  }

  private packPrompt(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  ): string {
    return messages
      .map((message) => {
        const role = message.role.toUpperCase();
        return `${role}:\n${message.content}`;
      })
      .join('\n\n---\n\n');
  }

  private runProcess(
    argv: string[],
    stdin: string,
    opts: { timeoutMs: number },
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = argv;
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(cmd, args, {
          cwd: tmpdir(),
          shell: process.platform === 'win32' && cmd.endsWith('.cmd'),
          env: this.buildChildEnv(),
          windowsHide: true,
        });
      } catch (err) {
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';
      let killedForSize = false;
      const killChild = () =>
        child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
      const timer = setTimeout(() => {
        killChild();
        reject(new Error(`codex CLI timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length + chunk.length > this.maxBytes) {
          if (!killedForSize) {
            killedForSize = true;
            killChild();
            clearTimeout(timer);
            reject(new Error('codex CLI output exceeded max bytes'));
          }
          return;
        }
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (killedForSize) return;
        resolve({ stdout, stderr, code });
      });

      child.stdin.end(stdin);
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
