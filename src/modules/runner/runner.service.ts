import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  ChildProcess,
  ChildProcessWithoutNullStreams,
  spawn,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { SystemsService } from '../systems/systems.service';
import { CodeGeneratorService } from './code-generator.service';
import { DeployDto } from './dto/deploy.dto';
import {
  DeploymentStatus,
  SystemDeploymentEntity,
} from './entities/system-deployment.entity';
import { RunnerEventPhase, RunnerEventsService } from './runner-events.service';

interface RunningProcess {
  deploymentId: string;
  child: ChildProcess;
  logStream: fs.WriteStream;
  startedAt: Date;
  timeout?: NodeJS.Timeout;
  sandboxMode: 'process' | 'docker';
  containerName?: string;
}

type LoggedChildProcess = ChildProcess & {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
};

export interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'db', 'dist', '.cache']);
const TEXT_FILE_EXTS = new Set([
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.html',
  '.htm',
  '.css',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
  '.sql',
  '.mjs',
  '.cjs',
]);
const MAX_EDITABLE_BYTES = 512 * 1024; // 512KB

@Injectable()
export class RunnerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RunnerService.name);
  private readonly processes = new Map<string, RunningProcess>();
  private readonly portRange: [number, number];
  private readonly logsRoot: string;
  private readonly processTimeoutMs: number;
  private readonly nodeMaxOldSpaceMb: number;
  private readonly sandboxMode: 'process' | 'docker';
  private readonly dockerImage: string;
  private readonly dockerNetwork: string;
  private readonly dockerCpus: string;
  private readonly dockerPidsLimit: number;

  constructor(
    @InjectRepository(SystemDeploymentEntity)
    private readonly deploymentsRepository: Repository<SystemDeploymentEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly systemsService: SystemsService,
    private readonly configService: ConfigService,
    private readonly codeGeneratorService: CodeGeneratorService,
    private readonly runnerEventsService: RunnerEventsService,
    private readonly jwtService: JwtService,
  ) {
    const start = Number(
      this.configService.get<number>('RUNNER_PORT_START', 4100),
    );
    const end = Number(this.configService.get<number>('RUNNER_PORT_END', 4500));
    this.portRange = [start, end];

    this.logsRoot = path.resolve(
      this.configService.get<string>('RUNNER_LOGS_ROOT', 'generated/logs'),
    );
    if (!fs.existsSync(this.logsRoot))
      fs.mkdirSync(this.logsRoot, { recursive: true });
    this.processTimeoutMs = this.configService.get<number>(
      'RUNNER_PROCESS_TIMEOUT_MS',
      30 * 60 * 1000,
    );
    this.nodeMaxOldSpaceMb = this.configService.get<number>(
      'RUNNER_NODE_MAX_OLD_SPACE_MB',
      128,
    );
    this.sandboxMode = this.configService.get<'process' | 'docker'>(
      'RUNNER_SANDBOX_MODE',
      'process',
    );
    this.dockerImage = this.configService.get<string>(
      'RUNNER_DOCKER_IMAGE',
      'node:20-bookworm-slim',
    );
    this.dockerNetwork = this.configService.get<string>(
      'RUNNER_DOCKER_NETWORK',
      'bridge',
    );
    this.dockerCpus = this.configService.get<string>(
      'RUNNER_DOCKER_CPUS',
      '0.5',
    );
    this.dockerPidsLimit = this.configService.get<number>(
      'RUNNER_DOCKER_PIDS_LIMIT',
      128,
    );
  }

  async onApplicationBootstrap() {
    // Reconcile any deployments left in a live-looking state from a previous
    // process. We cannot reattach to an old pid (it died with the backend),
    // so we respawn 'running' deployments and mark 'building'/'starting' as
    // crashed — those are mid-flight states that don't survive a restart.
    const zombie = await this.deploymentsRepository.find({
      where: { status: In(['running', 'starting', 'building']) },
    });
    if (zombie.length === 0) return;

    this.logger.log(`Reconciling ${zombie.length} deployment(s) after restart`);
    for (const d of zombie) {
      if (d.status === 'running') {
        try {
          // Respawn, don't await — parallel resume.
          void this.startInternal(d).catch((err) => {
            this.logger.warn(
              `Failed to resume deployment ${d.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        } catch (err) {
          this.logger.warn(
            `Resume failed for ${d.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        // building/starting mid-flight — mark crashed so the user can retry.
        await this.deploymentsRepository.update(
          { id: d.id },
          {
            status: 'crashed',
            errorMessage: `Backend restarted while status was '${d.status}'`,
            pid: null,
          },
        );
      }
    }
  }

  async onApplicationShutdown() {
    await Promise.all(
      [...this.processes.keys()].map((id) =>
        this.stopInternal(id, 'shutdown').catch(() => undefined),
      ),
    );
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async assertSystemReadAccess(systemId: string, actorUserId: string) {
    const system = await this.systemsService.findOne(systemId);
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'read',
      organizationId: system.organizationId,
      workspaceId: system.workspaceId ?? undefined,
      systemId,
    });
  }

  async listForSystem(systemId: string, actorUserId: string) {
    return this.list({ systemId }, actorUserId);
  }

  async list(
    filters: {
      systemId?: string;
      organizationId?: string;
      workspaceId?: string;
      status?: string;
    },
    actorUserId: string,
  ) {
    const where: FindOptionsWhere<SystemDeploymentEntity> = {};
    if (filters.systemId) where.systemId = filters.systemId;
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.workspaceId) where.workspaceId = filters.workspaceId;
    if (filters.status) where.status = filters.status as DeploymentStatus;

    const rows = await this.deploymentsRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: 50,
    });
    if (rows.length === 0) return [];
    const readable: SystemDeploymentEntity[] = [];
    for (const row of rows) {
      try {
        await this.accessControlService.assertResolvedAccess(actorUserId, {
          resource: 'system',
          action: 'read',
          organizationId: row.organizationId,
          workspaceId: row.workspaceId ?? undefined,
          systemId: row.systemId,
        });
        readable.push(row);
      } catch {
        // Keep workspace-level listing useful without leaking inaccessible rows.
      }
    }
    return readable;
  }

  async findOne(id: string, actorUserId: string) {
    const row = await this.deploymentsRepository.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Deployment not found');
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'read',
      organizationId: row.organizationId,
      workspaceId: row.workspaceId ?? undefined,
      systemId: row.systemId,
    });
    return row;
  }

  async deploy(dto: DeployDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'update',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      systemId: dto.systemId,
    });

    const sourceDir = this.codeGeneratorService.resolveDir(dto.systemId);
    if (!fs.existsSync(sourceDir)) {
      throw new NotFoundException(
        'No generated code found for this system. Run /runner/generate first.',
      );
    }

    const entity = this.deploymentsRepository.create({
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId ?? null,
      systemId: dto.systemId,
      runtime: dto.runtime ?? 'node',
      entrypoint: dto.entrypoint ?? 'server.js',
      sourceDir,
      status: 'pending',
      createdByUserId: actorUserId,
    });
    const saved = await this.deploymentsRepository.save(entity);
    this.runnerEventsService.emit({
      systemId: dto.systemId,
      deploymentId: saved.id,
      phase: 'deployment',
      level: 'info',
      message: 'Deployment queued',
      detail: `Runtime: ${saved.runtime}. Entrypoint: ${saved.entrypoint}.`,
    });

    // Kick off async
    void this.buildAndStart(saved.id).catch((err) => {
      this.logger.error(
        `Deployment ${saved.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return saved;
  }

  async start(deploymentId: string, actorUserId: string) {
    const deployment = await this.findOne(deploymentId, actorUserId);
    if (this.processes.has(deploymentId)) {
      return deployment;
    }
    this.runnerEventsService.emit({
      systemId: deployment.systemId,
      deploymentId,
      phase: 'deployment',
      level: 'info',
      message: 'Manual start requested',
    });
    await this.startInternal(deployment);
    return this.deploymentsRepository.findOneByOrFail({ id: deploymentId });
  }

  async stop(deploymentId: string, actorUserId: string) {
    const deployment = await this.findOne(deploymentId, actorUserId);
    this.runnerEventsService.emit({
      systemId: deployment.systemId,
      deploymentId,
      phase: 'deployment',
      level: 'info',
      message: 'Stopping preview process',
    });
    await this.stopInternal(deploymentId, 'user');
    return this.deploymentsRepository.findOneByOrFail({ id: deploymentId });
  }

  async logs(deploymentId: string, actorUserId: string, tail = 200) {
    const d = await this.findOne(deploymentId, actorUserId);
    if (!d.logPath || !fs.existsSync(d.logPath))
      return { lines: [] as string[] };
    const text = await fs.promises.readFile(d.logPath, 'utf8');
    const lines = text.split(/\r?\n/);
    return { lines: lines.slice(-tail) };
  }

  /**
   * Mint a short-lived token the iframe can use to call the proxy.
   * Reuses JWT_SECRET so the proxy can verify it with the same JwtModule.
   */
  async mintPreviewToken(deploymentId: string, actorUserId: string) {
    const d = await this.findOne(deploymentId, actorUserId);
    const token = this.jwtService.sign(
      {
        sub: actorUserId,
        kind: 'runner-preview',
        deploymentId: d.id,
      },
      { expiresIn: '1h' },
    );
    return {
      token,
      deploymentId: d.id,
      proxyPath: `/sys/${d.id}/`,
      expiresInSeconds: 3600,
    };
  }

  // ─── File tree + editor ─────────────────────────────────────────────────

  async listSourceFiles(deploymentId: string, actorUserId: string) {
    const d = await this.findOne(deploymentId, actorUserId);
    if (!fs.existsSync(d.sourceDir)) {
      return { tree: [] as FileNode[] };
    }
    const tree = this.buildTree(d.sourceDir, '');
    return { tree };
  }

  async readSourceFile(
    deploymentId: string,
    actorUserId: string,
    relPath: string,
  ) {
    const d = await this.findOne(deploymentId, actorUserId);
    const abs = this.resolveInside(d.sourceDir, relPath);
    const stat = await fs.promises.stat(abs);
    if (stat.isDirectory()) {
      throw new BadRequestException('Path is a directory, not a file');
    }
    if (stat.size > MAX_EDITABLE_BYTES) {
      throw new BadRequestException(
        `File too large to edit inline (${stat.size} bytes)`,
      );
    }
    const ext = path.extname(abs).toLowerCase();
    const editable = TEXT_FILE_EXTS.has(ext) || ext === '';
    const content = editable ? await fs.promises.readFile(abs, 'utf8') : null;
    return {
      path: relPath,
      size: stat.size,
      editable,
      content,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  async writeSourceFile(
    deploymentId: string,
    actorUserId: string,
    relPath: string,
    content: string,
  ) {
    const d = await this.deploymentsRepository.findOne({
      where: { id: deploymentId },
    });
    if (!d) throw new NotFoundException('Deployment not found');
    // Editing generated preview source follows normal system edit access.
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'update',
      organizationId: d.organizationId,
      workspaceId: d.workspaceId ?? undefined,
      systemId: d.systemId,
    });

    const abs = this.resolveInside(d.sourceDir, relPath);
    const parent = path.dirname(abs);
    if (!fs.existsSync(parent)) {
      await fs.promises.mkdir(parent, { recursive: true });
    }
    if (content.length > MAX_EDITABLE_BYTES) {
      throw new BadRequestException('Content exceeds 512KB limit');
    }
    await fs.promises.writeFile(abs, content, 'utf8');
    const stat = await fs.promises.stat(abs);
    this.runnerEventsService.emit({
      systemId: d.systemId,
      deploymentId,
      phase: 'file',
      level: 'done',
      message: `Saved ${relPath}`,
      detail: `${stat.size} bytes`,
    });
    return {
      path: relPath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private buildTree(root: string, rel: string): FileNode[] {
    const dir = path.join(root, rel);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.DS_Store')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          nodes.push({
            path: childRel,
            name: entry.name,
            type: 'dir',
            children: [],
          });
          continue;
        }
        nodes.push({
          path: childRel,
          name: entry.name,
          type: 'dir',
          children: this.buildTree(root, childRel),
        });
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(path.join(dir, entry.name)).size;
        } catch {
          /* ignore */
        }
        nodes.push({ path: childRel, name: entry.name, type: 'file', size });
      }
    }
    // Dirs first, then files, both alphabetical
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }

  private resolveInside(sourceDir: string, relPath: string): string {
    if (!relPath || typeof relPath !== 'string') {
      throw new BadRequestException('Missing path');
    }
    // Reject absolute, null bytes, windows drive letters.
    if (
      path.isAbsolute(relPath) ||
      relPath.includes('\0') ||
      /^[a-z]:[\\/]/i.test(relPath)
    ) {
      throw new BadRequestException('Invalid path');
    }
    const abs = path.resolve(sourceDir, relPath);
    const normRoot = path.resolve(sourceDir) + path.sep;
    if (abs !== path.resolve(sourceDir) && !abs.startsWith(normRoot)) {
      throw new BadRequestException('Path escapes deployment root');
    }
    return abs;
  }

  /**
   * Postgres schema name for a system. Keyed on systemId (not deploymentId)
   * so a system's data survives redeploys. Sanitized to a safe identifier.
   */
  private schemaName(systemId: string): string {
    return `sys_${systemId.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
  }

  /**
   * Provision the per-system Postgres schema before the generated app boots.
   * The generated app also runs CREATE SCHEMA IF NOT EXISTS defensively, but
   * doing it here guarantees the schema exists and is reused across redeploys.
   */
  private async ensureSchema(systemId: string): Promise<string> {
    const schema = this.schemaName(systemId);
    await this.deploymentsRepository.manager.query(
      `CREATE SCHEMA IF NOT EXISTS "${schema}"`,
    );
    return schema;
  }

  private async buildAndStart(deploymentId: string) {
    const d = await this.deploymentsRepository.findOneByOrFail({
      id: deploymentId,
    });
    await this.updateStatus(d.id, 'building', null);
    this.runnerEventsService.emit({
      systemId: d.systemId,
      deploymentId: d.id,
      phase: 'status',
      level: 'info',
      message: 'Deployment status changed',
      detail: 'building',
    });

    if (this.sandboxMode === 'process') {
      try {
        await this.runNpmInstall(d.sourceDir, d.id, d.systemId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.updateStatus(d.id, 'crashed', message);
        this.runnerEventsService.emit({
          systemId: d.systemId,
          deploymentId: d.id,
          phase: 'install',
          level: 'error',
          message: 'Dependency install failed',
          detail: message,
        });
        return;
      }
    } else {
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'install',
        level: 'info',
        message:
          'Skipping host install; Docker sandbox will install inside container',
      });
    }

    await this.startInternal(d);
  }

  private runNpmInstall(cwd: string, deploymentId: string, systemId: string) {
    return new Promise<void>((resolve, reject) => {
      const logPath = path.join(this.logsRoot, `${deploymentId}.log`);
      const logStream = fs.createWriteStream(logPath, { flags: 'a' });
      logStream.write(`\n─── npm install (${new Date().toISOString()}) ───\n`);

      this.runnerEventsService.emit({
        systemId,
        deploymentId,
        phase: 'install',
        level: 'info',
        message: 'Installing runtime dependencies',
        detail: 'npm install --omit=dev --no-audit --no-fund',
      });

      let npm: ChildProcessWithoutNullStreams;
      try {
        npm = spawn(
          process.platform === 'win32' ? 'npm.cmd' : 'npm',
          ['install', '--omit=dev', '--no-audit', '--no-fund'],
          {
            cwd,
            shell: false,
            env: this.buildChildEnv({ NODE_ENV: 'production' }),
            windowsHide: true,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logStream.write(`\nnpm spawn failed: ${message}\n`);
        logStream.end();
        this.runnerEventsService.emit({
          systemId,
          deploymentId,
          phase: 'install',
          level: 'error',
          message: 'npm failed to start',
          detail: message,
        });
        reject(err);
        return;
      }
      npm.stdout.on('data', (c) => logStream.write(c));
      npm.stderr.on('data', (c) => logStream.write(c));
      npm.stdout.on('data', (c: Buffer) =>
        this.emitLogChunk(systemId, deploymentId, 'install', c),
      );
      npm.stderr.on('data', (c: Buffer) =>
        this.emitLogChunk(systemId, deploymentId, 'install', c),
      );
      npm.on('error', (err) => {
        logStream.write(`\nnpm error: ${err.message}\n`);
        logStream.end();
        this.runnerEventsService.emit({
          systemId,
          deploymentId,
          phase: 'install',
          level: 'error',
          message: 'npm failed to start',
          detail: err.message,
        });
        reject(err);
      });
      npm.on('close', (code) => {
        logStream.write(`\nnpm install exited with code ${code}\n`);
        logStream.end();
        if (code === 0) {
          this.runnerEventsService.emit({
            systemId,
            deploymentId,
            phase: 'install',
            level: 'done',
            message: 'Dependencies installed',
          });
          resolve();
        } else {
          reject(new Error(`npm install failed (${code})`));
        }
      });
    });
  }

  private async startInternal(d: SystemDeploymentEntity) {
    if (this.sandboxMode === 'docker') {
      await this.startDockerInternal(d);
      return;
    }

    await this.updateStatus(d.id, 'starting', null);
    this.runnerEventsService.emit({
      systemId: d.systemId,
      deploymentId: d.id,
      phase: 'status',
      level: 'info',
      message: 'Deployment status changed',
      detail: 'starting',
    });

    const schema = await this.ensureSchema(d.systemId);

    const port = await this.allocatePort();
    this.runnerEventsService.emit({
      systemId: d.systemId,
      deploymentId: d.id,
      phase: 'runtime',
      level: 'info',
      message: 'Starting generated app',
      detail: `node ${d.entrypoint} on port ${port}`,
    });
    const logPath = path.join(this.logsRoot, `${d.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(
      `\n─── starting on port ${port} (${new Date().toISOString()}) ───\n`,
    );

    let entrypointAbs: string;
    try {
      entrypointAbs = this.resolveEntrypoint(d.sourceDir, d.entrypoint);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logStream.write(`\ninvalid entrypoint: ${message}\n`);
      logStream.end();
      await this.deploymentsRepository.update(
        { id: d.id },
        {
          status: 'crashed',
          errorMessage: message,
          logPath,
        },
      );
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'runtime',
        level: 'error',
        message: 'Preview process could not start',
        detail: message,
      });
      return;
    }

    const maxOldSpace = Number.isFinite(this.nodeMaxOldSpaceMb)
      ? Math.max(64, Math.floor(this.nodeMaxOldSpaceMb))
      : 128;
    let child: LoggedChildProcess;
    try {
      child = spawn(
        process.execPath,
        [`--max-old-space-size=${maxOldSpace}`, entrypointAbs],
        {
          cwd: d.sourceDir,
          env: this.buildChildEnv({
            PORT: port,
            NODE_ENV: 'production',
            STACK62_SANDBOX: '1',
            SYSTEM_SCHEMA: schema,
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      ) as LoggedChildProcess;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logStream.write(`\nspawn failed: ${message}\n`);
      logStream.end();
      await this.deploymentsRepository.update(
        { id: d.id },
        {
          status: 'crashed',
          errorMessage: message,
          logPath,
        },
      );
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'runtime',
        level: 'error',
        message: 'Preview process failed to start',
        detail: message,
      });
      return;
    }
    child.stdout.on('data', (c) => logStream.write(c));
    child.stderr.on('data', (c) => logStream.write(c));
    child.stdout.on('data', (c: Buffer) =>
      this.emitLogChunk(d.systemId, d.id, 'runtime', c),
    );
    child.stderr.on('data', (c: Buffer) =>
      this.emitLogChunk(d.systemId, d.id, 'runtime', c),
    );

    const running: RunningProcess = {
      deploymentId: d.id,
      child,
      logStream,
      startedAt: new Date(),
      sandboxMode: 'process',
    };
    running.timeout = setTimeout(() => {
      logStream.write(
        `\nprocess exceeded timeout ${this.processTimeoutMs}ms; terminating\n`,
      );
      child.kill();
    }, this.processTimeoutMs);
    running.timeout.unref?.();
    this.processes.set(d.id, running);

    let childFinished = false;
    child.once('error', (err) => {
      if (childFinished) return;
      childFinished = true;
      logStream.write(`\nprocess error: ${err.message}\n`);
      void this.handleChildExit(d, logStream, null, err.message);
    });
    child.on('exit', (code) => {
      if (childFinished) return;
      childFinished = true;
      void this.handleChildExit(d, logStream, code);
    });

    // Wait for port readiness (~8s)
    try {
      await this.waitForPort(port, 8000);
      await this.waitForHttpHealth(port, 8000);
      await this.deploymentsRepository.update(
        { id: d.id },
        {
          status: 'running',
          port,
          pid: child.pid ?? null,
          startedAt: new Date(),
          logPath,
          errorMessage: null,
        },
      );
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'status',
        level: 'done',
        message: 'Preview is running',
        detail: `Port ${port}`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Readiness check timeout';
      logStream.write(`\nReadiness timeout: ${message}\n`);
      await this.deploymentsRepository.update(
        { id: d.id },
        {
          status: 'crashed',
          errorMessage: message,
          logPath,
        },
      );
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'runtime',
        level: 'error',
        message: 'Preview failed readiness check',
        detail: message,
      });
      try {
        child.kill();
      } catch {
        /* noop */
      }
    }
  }

  private async startDockerInternal(d: SystemDeploymentEntity) {
    await this.updateStatus(d.id, 'starting', null);
    this.runnerEventsService.emit({
      systemId: d.systemId,
      deploymentId: d.id,
      phase: 'status',
      level: 'info',
      message: 'Deployment status changed',
      detail: 'starting in Docker sandbox',
    });

    const schema = await this.ensureSchema(d.systemId);

    const port = await this.allocatePort();
    const containerName = `stack62-${d.id.replace(/-/g, '').slice(0, 24)}`;
    const logPath = path.join(this.logsRoot, `${d.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(
      `\n--- docker sandbox on port ${port} (${new Date().toISOString()}) ---\n`,
    );

    const args = [
      'run',
      '--rm',
      '--name',
      containerName,
      '-p',
      `127.0.0.1:${port}:${port}`,
      '-e',
      `PORT=${port}`,
      '-e',
      'NODE_ENV=production',
      '-e',
      'STACK62_SANDBOX=1',
      '-e',
      `SYSTEM_SCHEMA=${schema}`,
      '-e',
      `DATABASE_URL=${process.env.DATABASE_URL ?? ''}`,
      '-e',
      `DATABASE_SSL=${process.env.DATABASE_SSL ?? ''}`,
      '--memory',
      `${this.nodeMaxOldSpaceMb}m`,
      '--cpus',
      this.dockerCpus,
      '--pids-limit',
      String(this.dockerPidsLimit),
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--network',
      this.dockerNetwork,
      '-w',
      '/app',
      '-v',
      `${d.sourceDir}:/app`,
      this.dockerImage,
      'sh',
      '-lc',
      `npm install --omit=dev --no-audit --no-fund && node ${this.shellEscape(
        d.entrypoint,
      )}`,
    ];

    this.runnerEventsService.emit({
      systemId: d.systemId,
      deploymentId: d.id,
      phase: 'runtime',
      level: 'info',
      message: 'Starting generated app in Docker sandbox',
      detail: `${this.dockerImage} on 127.0.0.1:${port}`,
    });

    let child: LoggedChildProcess;
    try {
      child = spawn('docker', args, {
        cwd: d.sourceDir,
        env: this.buildChildEnv({}),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }) as LoggedChildProcess;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logStream.write(`\ndocker spawn failed: ${message}\n`);
      logStream.end();
      await this.deploymentsRepository.update(
        { id: d.id },
        {
          status: 'crashed',
          errorMessage: message,
          logPath,
          metadata: {
            ...(d.metadata ?? {}),
            sandboxMode: 'docker',
            containerName,
          },
        },
      );
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'runtime',
        level: 'error',
        message: 'Docker preview failed to start',
        detail: message,
      });
      return;
    }
    child.stdout.on('data', (c) => logStream.write(c));
    child.stderr.on('data', (c) => logStream.write(c));
    child.stdout.on('data', (c: Buffer) =>
      this.emitLogChunk(d.systemId, d.id, 'runtime', c),
    );
    child.stderr.on('data', (c: Buffer) =>
      this.emitLogChunk(d.systemId, d.id, 'runtime', c),
    );

    const running: RunningProcess = {
      deploymentId: d.id,
      child,
      logStream,
      startedAt: new Date(),
      sandboxMode: 'docker',
      containerName,
    };
    running.timeout = setTimeout(() => {
      logStream.write(
        `\ncontainer exceeded timeout ${this.processTimeoutMs}ms; terminating\n`,
      );
      void this.stopDockerContainer(containerName);
      child.kill();
    }, this.processTimeoutMs);
    running.timeout.unref?.();
    this.processes.set(d.id, running);

    let childFinished = false;
    child.once('error', (err) => {
      if (childFinished) return;
      childFinished = true;
      logStream.write(`\ndocker process error: ${err.message}\n`);
      void this.handleChildExit(d, logStream, null, err.message);
    });
    child.on('exit', (code) => {
      if (childFinished) return;
      childFinished = true;
      void this.handleChildExit(d, logStream, code);
    });

    try {
      await this.waitForPort(port, 30000);
      await this.waitForHttpHealth(port, 30000);
      await this.deploymentsRepository.update(
        { id: d.id },
        {
          status: 'running',
          port,
          pid: child.pid ?? null,
          startedAt: new Date(),
          logPath,
          errorMessage: null,
          metadata: {
            ...(d.metadata ?? {}),
            sandboxMode: 'docker',
            containerName,
            dockerImage: this.dockerImage,
          },
        },
      );
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'status',
        level: 'done',
        message: 'Docker preview is running',
        detail: `Port ${port}`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Docker readiness check timeout';
      logStream.write(`\nReadiness timeout: ${message}\n`);
      await this.deploymentsRepository.update(
        { id: d.id },
        {
          status: 'crashed',
          errorMessage: message,
          logPath,
          metadata: {
            ...(d.metadata ?? {}),
            sandboxMode: 'docker',
            containerName,
          },
        },
      );
      this.runnerEventsService.emit({
        systemId: d.systemId,
        deploymentId: d.id,
        phase: 'runtime',
        level: 'error',
        message: 'Docker preview failed readiness check',
        detail: message,
      });
      await this.stopDockerContainer(containerName);
      child.kill();
    }
  }

  private async handleChildExit(
    d: SystemDeploymentEntity,
    logStream: fs.WriteStream,
    code: number | null,
    errorMessage?: string,
  ) {
    logStream.write(`\nprocess exited with code ${code}\n`);
    logStream.end();
    const running = this.processes.get(d.id);
    if (running?.timeout) clearTimeout(running.timeout);
    this.processes.delete(d.id);
    const final: DeploymentStatus = code === 0 ? 'stopped' : 'crashed';
    await this.deploymentsRepository.update(
      { id: d.id },
      {
        status: final,
        stoppedAt: new Date(),
        errorMessage:
          code === 0
            ? null
            : (errorMessage ?? `Process exited with code ${code}`),
        pid: null,
      },
    );
    this.runnerEventsService.emit({
      systemId: d.systemId,
      deploymentId: d.id,
      phase: 'runtime',
      level: code === 0 ? 'done' : 'error',
      message:
        code === 0 ? 'Preview process stopped' : 'Preview process crashed',
      detail: errorMessage ?? `Process exited with code ${code}`,
    });
  }

  private async stopInternal(deploymentId: string, reason: string) {
    const running = this.processes.get(deploymentId);
    if (!running) {
      await this.updateStatus(deploymentId, 'stopped', null);
      const deployment = await this.deploymentsRepository.findOne({
        where: { id: deploymentId },
      });
      if (deployment) {
        this.runnerEventsService.emit({
          systemId: deployment.systemId,
          deploymentId,
          phase: 'status',
          level: 'done',
          message: 'Preview is stopped',
          detail: reason,
        });
      }
      return;
    }
    running.child.kill();
    if (running.sandboxMode === 'docker' && running.containerName) {
      await this.stopDockerContainer(running.containerName);
    }
    if (running.timeout) clearTimeout(running.timeout);
    this.processes.delete(deploymentId);
    await this.updateStatus(deploymentId, 'stopped', null);
    const deployment = await this.deploymentsRepository.findOne({
      where: { id: deploymentId },
    });
    if (deployment) {
      this.runnerEventsService.emit({
        systemId: deployment.systemId,
        deploymentId,
        phase: 'status',
        level: 'done',
        message: 'Preview is stopped',
        detail: reason,
      });
    }
  }

  private emitLogChunk(
    systemId: string,
    deploymentId: string,
    phase: RunnerEventPhase,
    chunk: Buffer,
  ) {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      const message = line.trim();
      if (!message) continue;
      this.runnerEventsService.emit({
        systemId,
        deploymentId,
        phase,
        level: 'log',
        message: message.length > 500 ? `${message.slice(0, 497)}...` : message,
      });
    }
  }

  private async updateStatus(
    deploymentId: string,
    status: DeploymentStatus,
    errorMessage: string | null,
  ) {
    await this.deploymentsRepository.update(
      { id: deploymentId },
      { status, errorMessage },
    );
  }

  private stopDockerContainer(containerName: string) {
    return new Promise<void>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn('docker', ['stop', containerName], {
          env: this.buildChildEnv({}),
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        resolve();
        return;
      }
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });
  }

  private buildChildEnv(
    overrides: Record<string, string | number | null | undefined>,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== null && value !== undefined) env[key] = String(value);
    }
    return env;
  }

  private resolveEntrypoint(sourceDir: string, entrypoint: string): string {
    if (!entrypoint || typeof entrypoint !== 'string') {
      throw new BadRequestException('Missing deployment entrypoint');
    }
    const cleaned = entrypoint.replace(/^[/\\]+/, '');
    if (
      !cleaned ||
      cleaned.includes('\0') ||
      path.isAbsolute(cleaned) ||
      /^[a-z]:[\\/]/i.test(cleaned)
    ) {
      throw new BadRequestException('Invalid deployment entrypoint');
    }
    const abs = path.resolve(sourceDir, cleaned);
    const root = path.resolve(sourceDir);
    const rootWithSep = root + path.sep;
    if (abs !== root && !abs.startsWith(rootWithSep)) {
      throw new BadRequestException('Entrypoint escapes deployment root');
    }
    if (!fs.existsSync(abs)) {
      throw new BadRequestException(`Entrypoint not found: ${cleaned}`);
    }
    return abs;
  }

  private shellEscape(value: string) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  private async allocatePort(): Promise<number> {
    const [start, end] = this.portRange;
    for (let p = start; p <= end; p += 1) {
      if (await this.isPortFree(p)) return p;
    }
    throw new Error('No free ports in runner range.');
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net
        .createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          server.close(() => resolve(true));
        })
        .listen(port, '127.0.0.1');
    });
  }

  private async waitForPort(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await this.ping(port);
      if (ready) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Timed out waiting for port ${port}`);
  }

  private async waitForHttpHealth(
    port: number,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
      const result = await this.requestHealth(port);
      if (result.ok) return;
      lastError = result.error;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `Timed out waiting for /health on port ${port}${lastError ? `: ${lastError}` : ''}`,
    );
  }

  private requestHealth(port: number): Promise<{ ok: boolean; error: string }> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/health',
          method: 'GET',
          timeout: 1000,
        },
        (res) => {
          res.resume();
          resolve({
            ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
            error: `HTTP ${res.statusCode ?? 0}`,
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.end();
    });
  }

  private ping(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket
        .setTimeout(500)
        .once('connect', () => {
          socket.destroy();
          resolve(true);
        })
        .once('timeout', () => {
          socket.destroy();
          resolve(false);
        })
        .once('error', () => resolve(false))
        .connect(port, '127.0.0.1');
    });
  }
}
