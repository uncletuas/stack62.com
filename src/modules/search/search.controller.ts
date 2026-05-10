import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import {
  WorkspaceQuestionDto,
  WorkspaceSearchDto,
} from './dto/workspace-search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @RequireAccess({
    resource: 'workspace',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId' },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
  })
  @Get('workspace')
  workspace(@Query() query: WorkspaceSearchDto, @CurrentUser() user: JwtUser) {
    return this.searchService.workspace(query, user.userId);
  }

  @RequireAccess({
    resource: 'workspace',
    action: 'read',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post('workspace/ask')
  askWorkspace(
    @Body() body: WorkspaceQuestionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.searchService.askWorkspace(body, user.userId);
  }
}
