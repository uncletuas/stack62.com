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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CreateRecordDto } from './dto/create-record.dto';
import { ListRecordsDto } from './dto/list-records.dto';
import { UpdateRecordDto } from './dto/update-record.dto';
import {
  CreateRecordCollectionDto,
  CreateRecordFieldDto,
  CreateRecordItemDto,
  ListRecordCollectionsDto,
  UpdateRecordItemDto,
} from './dto/record-collection.dto';
import { RecordsService } from './records.service';

@ApiTags('records')
@ApiBearerAuth()
@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @RequireAccess({
    resource: 'record',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post('collections')
  createCollection(
    @Body() payload: CreateRecordCollectionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.createCollection(payload, user.userId);
  }

  @RequireAccess({
    resource: 'record',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get('collections')
  listCollections(
    @Query() query: ListRecordCollectionsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.listCollections(query, user.userId);
  }

  @RequireAccess({
    resource: 'record',
    action: 'read',
    allowUnscoped: true,
  })
  @Get('collections/:collectionId')
  findCollection(
    @Param('collectionId') collectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.findCollection(collectionId, user.userId);
  }

  @RequireAccess({
    resource: 'record',
    action: 'update',
    allowUnscoped: true,
  })
  @Post('collections/:collectionId/fields')
  createCollectionField(
    @Param('collectionId') collectionId: string,
    @Body() payload: CreateRecordFieldDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.createCollectionField(
      collectionId,
      payload,
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'record',
    action: 'read',
    allowUnscoped: true,
  })
  @Get('collections/:collectionId/items')
  listCollectionItems(
    @Param('collectionId') collectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.listCollectionItems(collectionId, user.userId);
  }

  @RequireAccess({
    resource: 'record',
    action: 'create',
    allowUnscoped: true,
  })
  @Post('collections/:collectionId/items')
  createCollectionItem(
    @Param('collectionId') collectionId: string,
    @Body() payload: CreateRecordItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.createCollectionItem(
      collectionId,
      payload,
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'record',
    action: 'update',
    allowUnscoped: true,
  })
  @Patch('items/:itemId')
  updateCollectionItem(
    @Param('itemId') itemId: string,
    @Body() payload: UpdateRecordItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.updateCollectionItem(
      itemId,
      payload,
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'record',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId' },
  })
  @Post()
  create(@Body() payload: CreateRecordDto, @CurrentUser() user: JwtUser) {
    return this.recordsService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'record',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListRecordsDto, @CurrentUser() user: JwtUser) {
    return this.recordsService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'record',
    action: 'read',
    resourceId: { source: 'param', key: 'recordId' },
  })
  @Get(':recordId')
  findOne(@Param('recordId') recordId: string) {
    return this.recordsService.findOne(recordId);
  }

  @RequireAccess({
    resource: 'record',
    action: 'update',
    resourceId: { source: 'param', key: 'recordId' },
  })
  @Patch(':recordId')
  update(
    @Param('recordId') recordId: string,
    @Body() payload: UpdateRecordDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordsService.update(recordId, payload, user.userId);
  }
}
