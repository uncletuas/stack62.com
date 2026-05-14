import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { FileShareEntity } from '../files/entities/file-share.entity';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { UsersModule } from '../users/users.module';
import { EmailSenderService } from './email-sender.service';
import { FileSharingController } from './file-sharing.controller';
import { FileSharingService } from './file-sharing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileShareEntity]),
    FilesModule,
    FoldersModule,
    UsersModule,
    ActivityModule,
  ],
  controllers: [FileSharingController],
  providers: [FileSharingService, EmailSenderService],
  exports: [FileSharingService, EmailSenderService],
})
export class FileSharingModule {}
