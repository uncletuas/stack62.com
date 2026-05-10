import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Invokes the Claude Code CLI (`claude`) as a subprocess so Stack62 can
 * design systems using the operator's existing Claude subscription — no
 * Anthropic API key required, same pattern Cline uses.
 *
 * Expectations of the host machine:
 *   - `claude` is on PATH (install via `npm i -g @anthropic-ai/claude-code`).
 *   - `claude` is already authenticated (`claude login` once, interactively).
 *
 * Model routing: any model string prefixed with `claude-code:<alias>` is
 * treated as a Claude Code request. Supported aliases: `sonnet`, `opus`,
 * `haiku`, or a full model name. Examples:
 *   `claude-code:sonnet`  → --model sonnet
 *   `claude-code:opus`    → --model opus
 *   `claude-code:claude-sonnet-4-6` → --model claude-sonnet-4-6
 */
@Injectable()
export class ClaudeCodeService {
  private readonly logger = new Logger(ClaudeCodeService.name);
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
      'CLAUDE_CODE_BIN',
      ClaudeCodeService.resolveDefaultBinary(),
    );
    this.timeoutMs = Number(
      this.configService.get<number>('CLAUDE_CODE_TIMEOUT_MS', 120_000),
    );
    this.maxBytes = Number(
      this.configService.get<number>('CLAUDE_CODE_MAX_BYTES', 4 * 1024 * 1024),
    );
  }

  /**
   * On Windows, npm installs a `claude.cmd` shim that cannot be spawned with
   * shell:false. The real binary is `claude.exe` sitting next to the shim.
   * Resolve that exe so we can always spawn with shell:false (safe arg passing).
   */
  private static resolveDefaultBinary(): string {
    if (process.platform !== 'win32') return 'claude';
    // Typical npm global install puts claude.cmd in %APPDATA%\npm\
    // and the real exe alongside it or in node_modules/.bin/
    const npmRoot = process.env.APPDATA
      ? resolve(process.env.APPDATA, 'npm')
      : null;
    const candidates = [
      npmRoot
        ? resolve(
            npmRoot,
            'node_modules',
            '@anthropic-ai',
            'claude-code',
            'bin',
            'claude.exe',
          )
        : null,
      npmRoot ? resolve(npmRoot, 'claude.exe') : null,
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    // Fall back to the .cmd shim — will need shell:true if we reach here.
    return npmRoot ? resolve(npmRoot, 'claude.cmd') : 'claude.cmd';
  }

  /** Returns `claude-code:<alias>` if the model string targets this provider. */
  static parseModel(model: string | null | undefined): string | null {
    if (!model) return null;
    if (model.startsWith('claude-code:'))
      return model.slice('claude-code:'.length) || null;
    return null;
  }

  /** Cached, non-throwing check of whether `claude --version` responds. */
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
        {
          timeoutMs: 5_000,
        },
      );
      if (code === 0) {
        const version = stdout.trim().split(/\s+/)[0] || null;
        this.availabilityCache = { available: true, version, checkedAt: now };
        return { available: true, version };
      }
    } catch (err) {
      this.logger.debug(
        `claude CLI not available: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.availabilityCache = {
      available: false,
      version: null,
      checkedAt: now,
    };
    return { available: false, version: null };
  }

  /**
   * Run a single-turn completion via `claude -p ... --output-format json`.
   *
   * The CLI is stateless in `--print` mode, so we pack the whole messages
   * array into one prompt with role markers. System prompts ride via
   * `--append-system-prompt` so they don't get confused with user text.
   */
  async complete(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    modelAlias: string | null,
    options?: { allowedTools?: string[]; permissionMode?: string },
  ): Promise<string> {
    const { available } = await this.isAvailable();
    if (!available) {
      throw new Error(
        'Claude Code CLI is not available on this host. Install @anthropic-ai/claude-code and run `claude login`.',
      );
    }

    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content.trim())
      .filter(Boolean);
    const convo = messages
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.role === 'assistant'
          ? `Assistant: ${m.content}`
          : `User: ${m.content}`,
      )
      .join('\n\n');

    const args: string[] = [
      '-p',
      convo || messages[messages.length - 1]?.content || '',
      '--output-format',
      'json',
      '--no-session-persistence',
      // Disable all tools — we only need text generation, no file/code access.
      '--tools',
      '',
      '--permission-mode',
      options?.permissionMode ?? 'bypassPermissions',
    ];

    if (modelAlias) {
      args.push('--model', modelAlias);
    }
    if (systemParts.length > 0) {
      args.push('--append-system-prompt', systemParts.join('\n\n'));
    }
    if (options?.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }

    const { stdout, stderr, code } = await this.runProcess(
      [this.binary, ...args],
      { timeoutMs: this.timeoutMs },
    );

    if (code !== 0) {
      throw new Error(
        `Claude Code CLI exited ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`,
      );
    }

    // `--output-format json` emits exactly one JSON object on stdout.
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(
        `Claude Code CLI returned non-JSON output: ${(err as Error).message}. First 400 chars: ${stdout.slice(0, 400)}`,
      );
    }

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'result' in parsed &&
      typeof (parsed as { result: unknown }).result === 'string'
    ) {
      return (parsed as { result: string }).result;
    }
    throw new Error(
      `Claude Code CLI JSON output missing 'result' field: ${stdout.slice(0, 200)}`,
    );
  }

  // ─── subprocess runner ──────────────────────────────────────────────────

  private runProcess(
    argv: string[],
    opts: { timeoutMs: number; cwd?: string },
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = argv;
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(cmd, args, {
          // Use a neutral directory so Claude doesn't pick up this project's
          // CLAUDE.md or codebase as context — that would cause it to scan
          // the entire repo before responding (multi-minute delay).
          cwd: opts.cwd ?? tmpdir(),
          shell: false,
          // Inherit env so claude picks up the user's auth / config.
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
        reject(new Error(`claude CLI timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);

      child.stdout.on('data', (c: Buffer) => {
        if (stdout.length + c.length > this.maxBytes) {
          if (!killedForSize) {
            killedForSize = true;
            killChild();
            clearTimeout(timer);
            reject(new Error('claude CLI output exceeded max bytes'));
          }
          return;
        }
        stdout += c.toString('utf8');
      });
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
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
