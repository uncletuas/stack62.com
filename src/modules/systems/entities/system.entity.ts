import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'systems' })
@Index(['organizationId', 'workspaceId', 'slug'], { unique: true })
export class SystemEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 180 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  purpose!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'team_size', type: 'int', nullable: true })
  teamSize!: number | null;

  @Column({
    name: 'industry_type',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  industryType!: string | null;

  @Column({ name: 'governance_mode', length: 80, default: 'standard' })
  governanceMode!: string;

  @Column({ length: 80, default: 'private' })
  visibility!: string;

  @Column({ length: 40, default: 'draft' })
  status!: string;

  @Column({ name: 'published_version_id', type: 'uuid', nullable: true })
  publishedVersionId!: string | null;
}
