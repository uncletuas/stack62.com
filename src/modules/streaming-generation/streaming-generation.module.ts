import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../shared/access-control/access-control.module';
import { StreamingGenerationController } from './streaming-generation.controller';
import { StreamingGenerationService } from './streaming-generation.service';

@Module({
  imports: [AccessControlModule],
  controllers: [StreamingGenerationController],
  providers: [StreamingGenerationService],
  exports: [StreamingGenerationService],
})
export class StreamingGenerationModule {}
