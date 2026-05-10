import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'system_versions' })
@Index(['systemId', 'versionNumber'], { unique: true })
export class SystemVersionEntity extends AppBaseEntity {
  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ name: 'version_number', type: 'int' })
  versionNumber!: number;

  @Column({ length: 40, default: 'draft' })
  status!: string;

  @Column({ name: 'change_summary', type: 'text', nullable: true })
  changeSummary!: string | null;

  @Column({ name: 'source_prompt', type: 'text', nullable: true })
  sourcePrompt!: string | null;

  @Column({ name: 'definition_snapshot', type: 'jsonb' })
  definitionSnapshot!: Record<string, unknown>;

  @Column({ name: 'compiled_snapshot', type: 'jsonb', nullable: true })
  compiledSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt!: Date | null;
}
