import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { PermissionPolicyEntity } from '../permissions/entities/permission-policy.entity';
import { RuntimeRecordEntity } from '../records/entities/runtime-record.entity';
import { WorkflowDefinitionEntity } from '../workflows/entities/workflow-definition.entity';
import { DashboardConfigEntity } from './entities/dashboard-config.entity';
import { EntityDefinitionEntity } from './entities/entity-definition.entity';
import { FieldDefinitionEntity } from './entities/field-definition.entity';
import { ModuleDefinitionEntity } from './entities/module-definition.entity';
import { SystemEntity } from './entities/system.entity';
import { SystemVersionEntity } from './entities/system-version.entity';
import { ViewConfigEntity } from './entities/view-config.entity';
import { SystemsController } from './systems.controller';
import { SystemsService } from './systems.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SystemEntity,
      SystemVersionEntity,
      ModuleDefinitionEntity,
      EntityDefinitionEntity,
      FieldDefinitionEntity,
      ViewConfigEntity,
      DashboardConfigEntity,
      WorkflowDefinitionEntity,
      PermissionPolicyEntity,
      RuntimeRecordEntity,
    ]),
    ActivityModule,
    AuditModule,
  ],
  controllers: [SystemsController],
  providers: [SystemsService],
  exports: [SystemsService, TypeOrmModule],
})
export class SystemsModule {}
