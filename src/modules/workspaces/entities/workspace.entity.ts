import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'workspaces' })
@Index(['organizationId', 'slug'], { unique: true })
export class WorkspaceEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 180 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ length: 40, default: 'active' })
  status!: string;
}
