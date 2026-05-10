import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'ai_generated_artifacts' })
@Index(['requestId', 'status'])
@Index(['organizationId', 'workspaceId', 'systemId'])
export class AiGeneratedArtifactEntity extends AppBaseEntity {
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId!: string | null;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ length: 80 })
  kind!: string;

  @Column({ name: 'relative_path', type: 'text' })
  relativePath!: string;

  @Column({ name: 'file_name', length: 255 })
  fileName!: string;

  @Column({ length: 40, default: 'generated' })
  status!: string;

  @Column({ name: 'content_preview', type: 'text', nullable: true })
  contentPreview!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
