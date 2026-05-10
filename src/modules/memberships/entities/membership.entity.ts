import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'memberships' })
@Index(['userId', 'organizationId', 'workspaceId'], { unique: true })
export class MembershipEntity extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ length: 80 })
  role!: string;

  @Column({ length: 40, default: 'active' })
  status!: string;
}
