import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { EntityDefinitionEntity } from '../systems/entities/entity-definition.entity';
import { FieldDefinitionEntity } from '../systems/entities/field-definition.entity';
import { RuntimeRecordEntity } from './entities/runtime-record.entity';
import { RecordCollectionEntity } from './entities/record-collection.entity';
import { RecordFieldEntity } from './entities/record-field.entity';
import { RecordItemEntity } from './entities/record-item.entity';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RuntimeRecordEntity,
      RecordCollectionEntity,
      RecordFieldEntity,
      RecordItemEntity,
      EntityDefinitionEntity,
      FieldDefinitionEntity,
    ]),
    ActivityModule,
    AuditModule,
  ],
  controllers: [RecordsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class RecordsModule {}
