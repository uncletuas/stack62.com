import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import type {
  WorkspaceActionInput,
  WorkspaceDocKind,
} from '../../shared/workspace-actions';
import { WorkspaceStateService } from './workspace-state.service';

/**
 * REST surface for the AI-native workspace state.
 *
 * Two patterns:
 *  - `POST /workspace/docs/:docId/actions`  — apply a typed action.
 *    Used by the engine `office.dispatch_action` tool and (after
 *    phase 2) for any non-realtime client.
 *  - `GET /workspace/docs/:docId/state`     — read current state.
 *    Snapshots only; for live updates the Hocuspocus channel will
 *    be the canonical path.
 *
 * Realtime Yjs sync goes over websocket (phase 2). This REST
 * surface stays the durable, AI-friendly entry point and the way
 * we test the action pipeline before the websocket is up.
 */
@ApiTags('workspace-state')
@ApiBearerAuth()
@Controller('workspace/docs')
export class WorkspaceStateController {
  constructor(private readonly service: WorkspaceStateService) {}

  @Get()
  async list(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('kind') kind: WorkspaceDocKind | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.list(organizationId, user.userId, {
      workspaceId,
      kind,
    });
  }

  @Get(':docId')
  async findOne(
    @Param('docId') docId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.findById(docId, user.userId);
  }

  @Get(':docId/state')
  async readState(
    @Param('docId') docId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.readState(docId, user.userId);
  }

  @Get(':docId/actions')
  async readActions(
    @Param('docId') docId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.readActionLog(
      docId,
      user.userId,
      limit ? parseInt(limit, 10) : 100,
    );
  }

  /**
   * Dispatch a typed action. The :docId in the URL is the target
   * doc (we strip it off the body so the URL is the canonical
   * pointer; for the `workspace.create_doc` verb the docId here
   * just needs to be a placeholder uuid since the doc doesn't
   * exist yet — the service ignores it and creates fresh).
   */
  @Post(':docId/actions')
  async dispatch(
    @Param('docId') docId: string,
    @Body() body: { organizationId: string; workspaceId?: string; action: Omit<WorkspaceActionInput, 'docId'> },
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.dispatch(
      { ...body.action, docId } as WorkspaceActionInput,
      {
        organizationId: body.organizationId,
        workspaceId: body.workspaceId ?? null,
        actorUserId: user.userId,
      },
    );
  }
}
