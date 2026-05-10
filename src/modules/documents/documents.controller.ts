import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { DocumentsService } from './documents.service';
import {
  CreateDocumentCommentDto,
  CreateDocumentDto,
  DocumentActionDto,
  DocumentToTasksDto,
  ListDocumentsDto,
  UpdateDocumentDto,
} from './dto/document.dto';
import { GenerateDocumentDto } from './dto/generate-document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @RequireAccess({
    resource: 'document',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post()
  create(@Body() payload: CreateDocumentDto, @CurrentUser() user: JwtUser) {
    return this.documentsService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListDocumentsDto, @CurrentUser() user: JwtUser) {
    return this.documentsService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'read',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Get(':documentId')
  findOne(@Param('documentId') documentId: string, @CurrentUser() user: JwtUser) {
    return this.documentsService.findOne(documentId, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'update',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Patch(':documentId')
  update(
    @Param('documentId') documentId: string,
    @Body() payload: UpdateDocumentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.update(documentId, payload, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'read',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Get(':documentId/versions')
  listVersions(
    @Param('documentId') documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.listVersions(documentId, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'read',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Get(':documentId/comments')
  listComments(
    @Param('documentId') documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.listComments(documentId, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'update',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Post(':documentId/comments')
  addComment(
    @Param('documentId') documentId: string,
    @Body() payload: CreateDocumentCommentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.addComment(documentId, payload, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'read',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Post(':documentId/summarize')
  summarize(
    @Param('documentId') documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.summarize(documentId, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'update',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Post(':documentId/rewrite')
  rewrite(
    @Param('documentId') documentId: string,
    @Body() payload: DocumentActionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.rewrite(documentId, payload, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'update',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Post(':documentId/tasks')
  turnIntoTasks(
    @Param('documentId') documentId: string,
    @Body() payload: DocumentToTasksDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.turnIntoTasks(documentId, payload, user.userId);
  }

  @RequireAccess({
    resource: 'document',
    action: 'update',
    resourceId: { source: 'param', key: 'documentId' },
  })
  @Post(':documentId/workflow')
  turnIntoWorkflow(
    @Param('documentId') documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.turnIntoWorkflow(documentId, user.userId);
  }

  @Post('generate')
  generate(@Body() payload: GenerateDocumentDto, @CurrentUser() user: JwtUser) {
    return this.documentsService.generate(payload, user.userId);
  }
}
