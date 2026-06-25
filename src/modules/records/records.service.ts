import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import {
  FieldDefinition,
  isFieldDataType,
  validateRecordValues,
} from '../../shared/system-definition';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../../shared/utils/slugify';
import { EntityDefinitionEntity } from '../systems/entities/entity-definition.entity';
import { FieldDefinitionEntity } from '../systems/entities/field-definition.entity';
import {
  CreateRecordCollectionDto,
  CreateRecordFieldDto,
  CreateRecordItemDto,
  ListRecordCollectionsDto,
  UpdateRecordItemDto,
} from './dto/record-collection.dto';
import { CreateRecordDto } from './dto/create-record.dto';
import { ListRecordsDto } from './dto/list-records.dto';
import { UpdateRecordDto } from './dto/update-record.dto';
import { RecordCollectionEntity } from './entities/record-collection.entity';
import { RecordFieldEntity } from './entities/record-field.entity';
import { RecordItemEntity } from './entities/record-item.entity';
import { RuntimeRecordEntity } from './entities/runtime-record.entity';

@Injectable()
export class RecordsService {
  constructor(
    @InjectRepository(RuntimeRecordEntity)
    private readonly recordsRepository: Repository<RuntimeRecordEntity>,
    @InjectRepository(RecordCollectionEntity)
    private readonly collectionsRepository: Repository<RecordCollectionEntity>,
    @InjectRepository(RecordFieldEntity)
    private readonly recordFieldsRepository: Repository<RecordFieldEntity>,
    @InjectRepository(RecordItemEntity)
    private readonly recordItemsRepository: Repository<RecordItemEntity>,
    @InjectRepository(EntityDefinitionEntity)
    private readonly entitiesRepository: Repository<EntityDefinitionEntity>,
    @InjectRepository(FieldDefinitionEntity)
    private readonly fieldsRepository: Repository<FieldDefinitionEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async createCollection(
    payload: CreateRecordCollectionDto,
    actorUserId: string,
  ) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'record',
      action: 'create',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
    });

    const collection = await this.collectionsRepository.save(
      this.collectionsRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        systemId: payload.systemId ?? null,
        createdByUserId: actorUserId,
        name: payload.name,
        key: payload.key ?? slugify(payload.name),
        description: payload.description ?? null,
        metadata: payload.metadata ?? null,
      }),
    );

    const fields = [];
    for (const [index, field] of (payload.fields ?? []).entries()) {
      fields.push(
        await this.createCollectionField(
          collection.id,
          field,
          actorUserId,
          index,
        ),
      );
    }

    await this.logRecordObject(
      'record_collection.create',
      collection,
      actorUserId,
      {
        fieldCount: fields.length,
      },
    );

    return { ...collection, fields };
  }

  async listCollections(
    filters: ListRecordCollectionsDto,
    actorUserId: string,
  ) {
    const qb = this.collectionsRepository.createQueryBuilder('collection');
    await this.accessControlService.applyTenantScopeToQueryBuilder(
      qb,
      'collection',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );
    if (filters.systemId) {
      qb.andWhere('collection.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }
    if (filters.status) {
      qb.andWhere('collection.status = :status', { status: filters.status });
    }
    return qb.orderBy('collection.updatedAt', 'DESC').take(200).getMany();
  }

  async findCollection(collectionId: string, actorUserId: string) {
    const collection = await this.collectionsRepository.findOne({
      where: { id: collectionId },
    });
    if (!collection)
      throw new NotFoundException('Record collection not found.');
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'record',
      action: 'read',
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
    });
    const fields = await this.recordFieldsRepository.find({
      where: { collectionId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return { ...collection, fields };
  }

  async createCollectionField(
    collectionId: string,
    payload: CreateRecordFieldDto,
    actorUserId: string,
    position?: number,
  ) {
    const collection = await this.collectionsRepository.findOne({
      where: { id: collectionId },
    });
    if (!collection)
      throw new NotFoundException('Record collection not found.');
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'record',
      action: 'update',
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
    });

    const count =
      position ??
      (await this.recordFieldsRepository.count({ where: { collectionId } }));
    const field = await this.recordFieldsRepository.save(
      this.recordFieldsRepository.create({
        collectionId,
        name: payload.name,
        key: payload.key ?? slugify(payload.name),
        dataType: payload.dataType ?? 'text',
        required: payload.required ?? false,
        position: count,
        config: payload.config ?? null,
      }),
    );

    await this.logRecordObject('record_field.create', collection, actorUserId, {
      fieldId: field.id,
      fieldKey: field.key,
    });

    return field;
  }

  async createCollectionItem(
    collectionId: string,
    payload: CreateRecordItemDto,
    actorUserId: string,
  ) {
    const { collection, fields } = await this.loadCollectionForWrite(
      collectionId,
      actorUserId,
    );
    this.validateCollectionItem(fields, payload.data, false);

    const item = await this.recordItemsRepository.save(
      this.recordItemsRepository.create({
        organizationId: collection.organizationId,
        workspaceId: collection.workspaceId,
        collectionId,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        data: payload.data,
        status: payload.status ?? 'active',
        metadata: payload.metadata ?? null,
      }),
    );

    await this.activityService.log({
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
      actorUserId,
      action: 'record_item.create',
      targetType: 'record_item',
      targetId: item.id,
      origin: 'user',
      metadata: { collectionId, collectionName: collection.name },
    });
    await this.auditService.log({
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
      actorUserId,
      action: 'record_item.create',
      targetType: 'record_item',
      targetId: item.id,
      afterData: item,
    });

    return item;
  }

  async listCollectionItems(collectionId: string, actorUserId: string) {
    await this.findCollection(collectionId, actorUserId);
    return this.recordItemsRepository.find({
      where: { collectionId },
      order: { updatedAt: 'DESC' },
      take: 500,
    });
  }

  async updateCollectionItem(
    itemId: string,
    payload: UpdateRecordItemDto,
    actorUserId: string,
  ) {
    const item = await this.recordItemsRepository.findOne({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException('Record item not found.');
    const { collection, fields } = await this.loadCollectionForWrite(
      item.collectionId,
      actorUserId,
    );

    const beforeData = { ...item.data };
    if (payload.data) {
      const merged = { ...item.data, ...payload.data };
      this.validateCollectionItem(fields, merged, true);
      item.data = merged;
    }
    item.status = payload.status ?? item.status;
    item.metadata = payload.metadata ?? item.metadata;
    item.updatedByUserId = actorUserId;

    const updated = await this.recordItemsRepository.save(item);
    await this.activityService.log({
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
      actorUserId,
      action: 'record_item.update',
      targetType: 'record_item',
      targetId: updated.id,
      origin: 'user',
      metadata: {
        collectionId: collection.id,
        collectionName: collection.name,
      },
    });
    await this.auditService.log({
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
      actorUserId,
      action: 'record_item.update',
      targetType: 'record_item',
      targetId: updated.id,
      beforeData,
      afterData: updated,
    });

    return updated;
  }

  async create(payload: CreateRecordDto, actorUserId: string) {
    await this.validateRecordData(
      payload.entityDefinitionId,
      payload.data,
      false,
    );

    const record = this.recordsRepository.create({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
      moduleDefinitionId: payload.moduleDefinitionId,
      entityDefinitionId: payload.entityDefinitionId,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
      status: payload.status ?? 'active',
      data: payload.data,
      metadata: payload.metadata ?? null,
    });

    const createdRecord = await this.recordsRepository.save(record);

    await this.activityService.log({
      organizationId: createdRecord.organizationId,
      workspaceId: createdRecord.workspaceId,
      systemId: createdRecord.systemId,
      actorUserId,
      action: 'record.create',
      targetType: 'record',
      targetId: createdRecord.id,
      origin: 'user',
      metadata: { entityDefinitionId: createdRecord.entityDefinitionId },
    });

    await this.auditService.log({
      organizationId: createdRecord.organizationId,
      workspaceId: createdRecord.workspaceId,
      systemId: createdRecord.systemId,
      actorUserId,
      action: 'record.create',
      targetType: 'record',
      targetId: createdRecord.id,
      afterData: createdRecord,
    });

    return createdRecord;
  }

  async findAll(filters: ListRecordsDto, actorUserId: string) {
    const queryBuilder = this.recordsRepository.createQueryBuilder('record');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'record',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('record.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.moduleDefinitionId) {
      queryBuilder.andWhere('record.moduleDefinitionId = :moduleDefinitionId', {
        moduleDefinitionId: filters.moduleDefinitionId,
      });
    }

    if (filters.entityDefinitionId) {
      queryBuilder.andWhere('record.entityDefinitionId = :entityDefinitionId', {
        entityDefinitionId: filters.entityDefinitionId,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('record.status = :status', {
        status: filters.status,
      });
    }

    return queryBuilder.orderBy('record.createdAt', 'DESC').take(200).getMany();
  }

  async findOne(recordId: string) {
    const record = await this.recordsRepository.findOne({
      where: { id: recordId },
    });

    if (!record) {
      throw new NotFoundException('Record not found.');
    }

    const entityDefinition = await this.entitiesRepository.findOne({
      where: { id: record.entityDefinitionId },
    });
    const fields = await this.fieldsRepository.find({
      where: { entityDefinitionId: record.entityDefinitionId },
      order: { createdAt: 'ASC' },
    });

    return {
      ...record,
      entityDefinition,
      fields,
    };
  }

  async update(
    recordId: string,
    payload: UpdateRecordDto,
    actorUserId: string,
  ) {
    const record = await this.recordsRepository.findOne({
      where: { id: recordId },
    });
    if (!record) {
      throw new NotFoundException('Record not found.');
    }

    const beforeData = { ...record.data };

    if (payload.data) {
      const mergedData = { ...record.data, ...payload.data };
      await this.validateRecordData(
        record.entityDefinitionId,
        mergedData,
        true,
      );
      record.data = mergedData;
    }

    record.status = payload.status ?? record.status;
    record.metadata = payload.metadata ?? record.metadata;
    record.updatedByUserId = actorUserId;

    const updatedRecord = await this.recordsRepository.save(record);

    await this.activityService.log({
      organizationId: updatedRecord.organizationId,
      workspaceId: updatedRecord.workspaceId,
      systemId: updatedRecord.systemId,
      actorUserId,
      action: 'record.update',
      targetType: 'record',
      targetId: updatedRecord.id,
      origin: 'user',
      metadata: { entityDefinitionId: updatedRecord.entityDefinitionId },
    });

    await this.auditService.log({
      organizationId: updatedRecord.organizationId,
      workspaceId: updatedRecord.workspaceId,
      systemId: updatedRecord.systemId,
      actorUserId,
      action: 'record.update',
      targetType: 'record',
      targetId: updatedRecord.id,
      beforeData,
      afterData: updatedRecord,
    });

    return updatedRecord;
  }

  private async validateRecordData(
    entityDefinitionId: string,
    data: Record<string, unknown>,
    partial: boolean,
  ) {
    const entityDefinition = await this.entitiesRepository.findOne({
      where: { id: entityDefinitionId },
    });

    if (!entityDefinition) {
      throw new NotFoundException('Entity definition not found.');
    }

    const fieldEntities = await this.fieldsRepository.find({
      where: { entityDefinitionId },
    });

    const fields: FieldDefinition[] = fieldEntities.map((field) => {
      if (!isFieldDataType(field.dataType)) {
        throw new UnprocessableEntityException(
          `Field '${field.key}' has unsupported data type '${field.dataType}'.`,
        );
      }
      return {
        name: field.name,
        key: field.key,
        dataType: field.dataType,
        required: field.required,
        config: (field.config as FieldDefinition['config']) ?? null,
      };
    });

    const errors = validateRecordValues(fields, data, { partial });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Record validation failed.',
        errors,
      });
    }
  }

  private async loadCollectionForWrite(
    collectionId: string,
    actorUserId: string,
  ) {
    const collection = await this.collectionsRepository.findOne({
      where: { id: collectionId },
    });
    if (!collection)
      throw new NotFoundException('Record collection not found.');
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'record',
      action: 'update',
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
    });
    const fields = await this.recordFieldsRepository.find({
      where: { collectionId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return { collection, fields };
  }

  private validateCollectionItem(
    fields: RecordFieldEntity[],
    data: Record<string, unknown>,
    partial: boolean,
  ) {
    const errors: string[] = [];
    for (const field of fields) {
      const value = data[field.key];
      if (
        !partial &&
        field.required &&
        (value === null || value === undefined || value === '')
      ) {
        errors.push(`${field.name} is required.`);
      }
      if (value === null || value === undefined || value === '') continue;
      if (field.dataType === 'number' && typeof value !== 'number') {
        errors.push(`${field.name} must be a number.`);
      }
      if (field.dataType === 'boolean' && typeof value !== 'boolean') {
        errors.push(`${field.name} must be true or false.`);
      }
    }
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Record item validation failed.',
        errors,
      });
    }
  }

  private async logRecordObject(
    action: string,
    collection: RecordCollectionEntity,
    actorUserId: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.activityService.log({
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
      actorUserId,
      action,
      targetType: 'record_collection',
      targetId: collection.id,
      origin: 'user',
      metadata: { name: collection.name, ...metadata },
    });
    await this.auditService.log({
      organizationId: collection.organizationId,
      workspaceId: collection.workspaceId,
      systemId: collection.systemId,
      actorUserId,
      action,
      targetType: 'record_collection',
      targetId: collection.id,
      afterData: collection,
      metadata,
    });
  }
}
