import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../../shared/access-control/access-control.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { EmbeddingService } from './embedding.service';
import { DocumentChunkEntity } from './entities/document-chunk.entity';
import { SemanticSearchController } from './semantic-search.controller';
import { SemanticSearchService } from './semantic-search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentChunkEntity]),
    FilesModule,
    FoldersModule,
    DocumentExtractionModule,
    AccessControlModule,
  ],
  controllers: [SemanticSearchController],
  providers: [EmbeddingService, SemanticSearchService],
  exports: [SemanticSearchService, EmbeddingService],
})
export class SemanticSearchModule {}
