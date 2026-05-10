import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { AdvanceWorkflowRunDto } from './dto/advance-workflow-run.dto';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { ListWorkflowDefinitionsDto } from './dto/list-workflow-definitions.dto';
import { ListWorkflowRunsDto } from './dto/list-workflow-runs.dto';
import { StartWorkflowRunDto } from './dto/start-workflow-run.dto';
import { WorkflowsService } from './workflows.service';

@ApiTags('workflows')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @RequireAccess({
    resource: 'workflow_definition',
    action: 'manage_workflows',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId' },
  })
  @Post('definitions')
  create(
    @Body() payload: CreateWorkflowDefinitionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.workflowsService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'workflow_definition',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get('definitions')
  findAll(
    @Query() query: ListWorkflowDefinitionsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.workflowsService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'workflow_definition',
    action: 'manage_workflows',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId' },
  })
  @Post('runs')
  startRun(@Body() payload: StartWorkflowRunDto, @CurrentUser() user: JwtUser) {
    return this.workflowsService.startRun(payload, user.userId);
  }

  @RequireAccess({
    resource: 'workflow_definition',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get('runs')
  findRuns(@Query() query: ListWorkflowRunsDto, @CurrentUser() user: JwtUser) {
    return this.workflowsService.findRuns(query, user.userId);
  }

  @Get('runs/:runId')
  findRun(@Param('runId') runId: string, @CurrentUser() user: JwtUser) {
    return this.workflowsService.findRun(runId, user.userId);
  }

  @Post('runs/:runId/advance')
  advanceRun(
    @Param('runId') runId: string,
    @Body() payload: AdvanceWorkflowRunDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.workflowsService.advanceRun(runId, payload, user.userId);
  }
}
