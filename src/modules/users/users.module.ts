import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { FilesModule } from '../files/files.module';
import { DataExportController } from './data-export.controller';
import { UserEntity } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    ActivityModule,
    FilesModule,
  ],
  controllers: [UsersController, DataExportController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
