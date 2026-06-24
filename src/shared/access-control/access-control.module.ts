import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiChangeRequestEntity } from '../../modules/ai/entities/ai-change-request.entity';
import { CoworkerEntity } from '../../modules/coworker/entities/coworker.entity';
import { DocumentEntity } from '../../modules/documents/entities/document.entity';
import { FileEntity } from '../../modules/files/entities/file.entity';
import { BackgroundJobEntity } from '../../modules/jobs/entities/background-job.entity';
import { MembershipEntity } from '../../modules/memberships/entities/membership.entity';
import { OrganizationEntity } from '../../modules/organizations/entities/organization.entity';
import { PermissionPolicyEntity } from '../../modules/permissions/entities/permission-policy.entity';
import { RuntimeRecordEntity } from '../../modules/records/entities/runtime-record.entity';
import { ReportEntity } from '../../modules/reports/entities/report.entity';
import { ScheduleEntity } from '../../modules/schedules/entities/schedule.entity';
import { SharePackageEntity } from '../../modules/sharing/entities/share-package.entity';
import { SystemEntity } from '../../modules/systems/entities/system.entity';
import { TaskEntity } from '../../modules/tasks/entities/task.entity';
import { WorkflowDefinitionEntity } from '../../modules/workflows/entities/workflow-definition.entity';
import { WorkspaceEntity } from '../../modules/workspaces/entities/workspace.entity';
import { AccessControlService } from './access-control.service';
import { TenantAccessGuard } from './access-control.guard';
import { PlatformRoleGuard } from './platform-role.guard';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiChangeRequestEntity,
      BackgroundJobEntity,
      CoworkerEntity,
      DocumentEntity,
      FileEntity,
      MembershipEntity,
      OrganizationEntity,
      PermissionPolicyEntity,
      RuntimeRecordEntity,
      ReportEntity,
      ScheduleEntity,
      SharePackageEntity,
      SystemEntity,
      TaskEntity,
      WorkflowDefinitionEntity,
      WorkspaceEntity,
    ]),
  ],
  providers: [AccessControlService, TenantAccessGuard, PlatformRoleGuard],
  exports: [AccessControlService, TenantAccessGuard, PlatformRoleGuard],
})
export class AccessControlModule {}
