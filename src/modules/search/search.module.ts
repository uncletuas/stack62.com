import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity } from '../documents/entities/document.entity';
import { FileEntity } from '../files/entities/file.entity';
import { RuntimeRecordEntity } from '../records/entities/runtime-record.entity';
import { ScheduleEntity } from '../schedules/entities/schedule.entity';
import { SystemEntity } from '../systems/entities/system.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { AiModule } from '../ai/ai.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ContentIndexService } from './content-index.service';
import { ContentChunkEntity } from './entities/content-chunk.entity';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentEntity,
      FileEntity,
      RuntimeRecordEntity,
      ScheduleEntity,
      SystemEntity,
      TaskEntity,
      ContentChunkEntity,
    ]),
    forwardRef(() => AiModule),
    OrganizationsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService, ContentIndexService],
  exports: [SearchService, ContentIndexService],
})
export class SearchModule {}
