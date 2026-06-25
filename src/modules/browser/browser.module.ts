import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrowserController } from './browser.controller';
import { BrowserService } from './browser.service';
import { BrowserSessionService } from './browser-session.service';
import { BrowserHistoryEntity } from './entities/browser-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BrowserHistoryEntity])],
  controllers: [BrowserController],
  providers: [BrowserSessionService, BrowserService],
  exports: [BrowserService, BrowserSessionService],
})
export class BrowserModule {}
