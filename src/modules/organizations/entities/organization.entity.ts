import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'organizations' })
export class OrganizationEntity extends AppBaseEntity {
  @Column({ length: 180 })
  name!: string;

  @Index({ unique: true })
  @Column({ length: 180 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ length: 40, default: 'active' })
  status!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @Column({ name: 'openrouter_api_key', type: 'text', nullable: true })
  openrouterApiKey!: string | null;

  @Column({
    name: 'preferred_model',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  preferredModel!: string | null;
}
