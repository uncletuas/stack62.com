import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'node:fs';
import { dirname, extname, normalize, resolve } from 'node:path';
import { Repository } from 'typeorm';
import { AiChangePlan } from './schemas/change-plan.schema';
import { AiGeneratedArtifactEntity } from './entities/ai-generated-artifact.entity';
import { AiChangeRequestEntity } from './entities/ai-change-request.entity';

interface GenerateArtifactsInput {
  request: AiChangeRequestEntity;
  planId: string;
  plan: AiChangePlan;
}

@Injectable()
export class StudioArtifactService {
  private readonly logger = new Logger(StudioArtifactService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(AiGeneratedArtifactEntity)
    private readonly artifactsRepository: Repository<AiGeneratedArtifactEntity>,
  ) {}

  async listByRequest(requestId: string) {
    return this.artifactsRepository.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
  }

  async generateFromPlan({
    request,
    planId,
    plan,
  }: GenerateArtifactsInput): Promise<AiGeneratedArtifactEntity[]> {
    if (!request.generateArtifacts) {
      return [];
    }

    const plannedArtifacts =
      plan.artifacts.length > 0
        ? plan.artifacts
        : [
            {
              kind: 'plan_snapshot',
              relativePath: `request-${request.id}/change-plan.json`,
              content: JSON.stringify(plan, null, 2),
              overwrite: true,
              metadata: {
                generatedBy: 'studio_engine',
              },
            },
          ];

    const maxArtifacts = this.configService.get<number>(
      'STUDIO_MAX_ARTIFACTS_PER_REQUEST',
      8,
    );
    const allowedExtensions = new Set(
      this.configService
        .get<string>(
          'STUDIO_ALLOWED_ARTIFACT_EXTENSIONS',
          'json,md,txt,ts,tsx,yml,yaml',
        )
        .split(',')
        .map((entry) => entry.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean),
    );

    const baseDirectory = resolve(
      process.cwd(),
      this.configService.get<string>(
        'STUDIO_ARTIFACTS_DIR',
        'generated/studio',
      ),
    );
    await fs.mkdir(baseDirectory, { recursive: true });

    const persistedArtifacts: AiGeneratedArtifactEntity[] = [];
    for (const artifact of plannedArtifacts.slice(0, maxArtifacts)) {
      try {
        const safeRelativePath = this.ensureSafeRelativePath(
          artifact.relativePath,
        );
        const extension = extname(safeRelativePath)
          .replace('.', '')
          .toLowerCase();
        if (!extension || !allowedExtensions.has(extension)) {
          throw new Error(
            `Artifact extension '.${extension || 'unknown'}' is not allowed by policy.`,
          );
        }

        const targetPath = resolve(baseDirectory, safeRelativePath);
        if (!targetPath.startsWith(baseDirectory)) {
          throw new Error(
            'Artifact path escapes the configured sandbox directory.',
          );
        }

        await fs.mkdir(dirname(targetPath), { recursive: true });
        if (artifact.overwrite === false) {
          try {
            await fs.access(targetPath);
            throw new Error(
              `Artifact already exists and overwrite is disabled: ${safeRelativePath}`,
            );
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !error.message.includes('already exists')
            ) {
              // File does not exist, safe to continue.
            } else {
              throw error;
            }
          }
        }

        await fs.writeFile(targetPath, artifact.content, 'utf8');

        const savedArtifact = await this.artifactsRepository.save(
          this.artifactsRepository.create({
            requestId: request.id,
            planId,
            organizationId: request.organizationId,
            workspaceId: request.workspaceId,
            systemId: request.systemId,
            kind: artifact.kind,
            relativePath: safeRelativePath,
            fileName: safeRelativePath.split('/').pop() ?? 'artifact',
            status: 'generated',
            contentPreview: artifact.content.slice(0, 500),
            metadata: {
              ...(artifact.metadata ?? {}),
              sandboxPath: targetPath,
            },
          }),
        );

        persistedArtifacts.push(savedArtifact);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown artifact generation failure.';
        this.logger.warn(
          `Artifact generation skipped for request ${request.id}: ${message}`,
        );
        await this.artifactsRepository.save(
          this.artifactsRepository.create({
            requestId: request.id,
            planId,
            organizationId: request.organizationId,
            workspaceId: request.workspaceId,
            systemId: request.systemId,
            kind: artifact.kind,
            relativePath: artifact.relativePath,
            fileName: artifact.relativePath.split(/[\\/]/).pop() ?? 'artifact',
            status: 'rejected',
            contentPreview: artifact.content.slice(0, 500),
            metadata: {
              ...(artifact.metadata ?? {}),
              error: message,
            },
          }),
        );
      }
    }

    return persistedArtifacts;
  }

  private ensureSafeRelativePath(relativePath: string) {
    const normalized = normalize(relativePath.replace(/\\/g, '/')).replace(
      /^\/+/,
      '',
    );
    if (
      !normalized ||
      normalized.includes('..') ||
      normalized.startsWith('/')
    ) {
      throw new Error(`Unsafe artifact path rejected: ${relativePath}`);
    }

    return normalized.split('/').filter(Boolean).join('/');
  }
}
