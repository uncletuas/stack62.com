import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { FolderAclEntity } from './entities/folder-acl.entity';
import { FolderEntity } from './entities/folder.entity';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FolderEntity, FolderAclEntity, MembershipEntity]),
    ActivityModule,
  ],
  controllers: [FoldersController],
  providers: [FoldersService],
  exports: [FoldersService, TypeOrmModule],
})
export class FoldersModule {}
