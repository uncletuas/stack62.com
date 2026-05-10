import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { SharePackageEntity } from './entities/share-package.entity';
import { SharePermissionEntity } from './entities/share-permission.entity';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SharePackageEntity, SharePermissionEntity]),
    ActivityModule,
    AuditModule,
  ],
  controllers: [SharingController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
