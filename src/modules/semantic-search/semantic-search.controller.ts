import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { SemanticSearchService } from './semantic-search.service';

@ApiTags('semantic-search')
@ApiBearerAuth()
@Controller('semantic-search')
export class SemanticSearchController {
  constructor(private readonly semanticSearch: SemanticSearchService) {}

  /**
   * "Find me documents about X" — embeds the query and returns top-K
   * matching chunks, scoped to the org and the folders the caller can read.
   */
  @Get('search')
  search(
    @Query('organizationId') organizationId: string,
    @Query('q') q: string,
    @Query('limit') limit: string | undefined,
    @Query('folderId') folderId: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.semanticSearch.searchSimilar(organizationId, q, user.userId, {
      limit: limit ? Number(limit) : 8,
      folderId: folderId || null,
    });
  }

  /** Trigger (re-)indexing for a file. Called by the FE after upload. */
  @Post('index/:fileId')
  index(@Param('fileId') fileId: string, @CurrentUser() user: JwtUser) {
    return this.semanticSearch
      .indexFile(fileId, user.userId)
      .then((chunks) => ({ chunks }));
  }
}
