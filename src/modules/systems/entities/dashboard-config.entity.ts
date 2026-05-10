import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'dashboard_configs' })
export class DashboardConfigEntity extends AppBaseEntity {
  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'system_version_id', type: 'uuid' })
  systemVersionId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 80, default: 'system' })
  scope!: string;

  @Column({ type: 'jsonb', nullable: true })
  widgets!: Array<Record<string, unknown>> | null;
}
