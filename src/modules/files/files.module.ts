import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { StorageModule } from '../../shared/storage';
import { SearchModule } from '../search/search.module';
import { FileEntity } from './entities/file.entity';
import { FileShareEntity } from './entities/file-share.entity';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity, FileShareEntity]),
    MulterModule.register({ storage: memoryStorage() }),
    SearchModule,
    StorageModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
