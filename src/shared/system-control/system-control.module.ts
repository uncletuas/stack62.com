import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettingEntity } from '../../modules/admin/entities/platform-setting.entity';
import { SystemControlMiddleware } from './system-control.middleware';
import { SystemControlService } from './system-control.service';

/**
 * Global module for runtime emergency controls. Exports SystemControlService so
 * the admin System controller can toggle flags, and SystemControlMiddleware so
 * AppModule can apply it across the customer API surface.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PlatformSettingEntity])],
  providers: [SystemControlService, SystemControlMiddleware],
  exports: [SystemControlService, SystemControlMiddleware],
})
export class SystemControlModule {}
