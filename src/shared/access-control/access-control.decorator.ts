import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { TenantAccessGuard } from './access-control.guard';

export const ACCESS_CONTROL_METADATA_KEY = 'stack62:access-control';

export type AccessAction =
  | 'read'
  | 'create'
  | 'update'
  | 'publish'
  | 'share'
  | 'manage_workflows'
  | 'manage_permissions'
  | 'manage_ai'
  | 'apply_ai'
  | 'view_jobs'
  | 'manage_memberships';

export type AccessResource =
  | 'organization'
  | 'workspace'
  | 'membership'
  | 'system'
  | 'record'
  | 'activity'
  | 'workflow_definition'
  | 'workflow_run'
  | 'permission_policy'
  | 'share_package'
  | 'ai_change_request'
  | 'background_job'
  | 'task'
  | 'schedule'
  | 'file'
  | 'document'
  | 'report'
  | 'coworker'
  | 'integration'
  | 'tool_call';

export interface RequestValueReference {
  source: 'body' | 'query' | 'param';
  key: string;
  optional?: boolean;
}

export interface AccessControlRequirement {
  resource: AccessResource;
  action: AccessAction;
  resourceId?: RequestValueReference;
  organizationId?: RequestValueReference;
  workspaceId?: RequestValueReference;
  systemId?: RequestValueReference;
  allowUnscoped?: boolean;
}

export function RequireAccess(requirement: AccessControlRequirement) {
  return applyDecorators(
    SetMetadata(ACCESS_CONTROL_METADATA_KEY, requirement),
    UseGuards(TenantAccessGuard),
  );
}
