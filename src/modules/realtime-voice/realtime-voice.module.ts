import { Module } from '@nestjs/common';
import { RealtimeVoiceController } from './realtime-voice.controller';

@Module({
  controllers: [RealtimeVoiceController],
})
export class RealtimeVoiceModule {}
