import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { FilesModule } from '../files/files.module';
import { DocumentExtractionController } from './document-extraction.controller';
import { DocumentExtractionService } from './document-extraction.service';
import { DocumentExtractionEntity } from './entities/document-extraction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentExtractionEntity]),
    ActivityModule,
    FilesModule,
  ],
  controllers: [DocumentExtractionController],
  providers: [DocumentExtractionService],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}
