import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { SearchModule } from '../search/search.module';
import { FileEntity } from './entities/file.entity';
import { FolderEntity } from './entities/folder.entity';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity, FolderEntity]),
    MulterModule.register({ storage: memoryStorage() }),
    SearchModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
