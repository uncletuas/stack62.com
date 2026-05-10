import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { DocumentExtractionService } from './document-extraction.service';
import type { ExtractionDocumentType } from './entities/document-extraction.entity';

@ApiTags('document-extraction')
@ApiBearerAuth()
@Controller('document-extraction')
export class DocumentExtractionController {
  constructor(
    private readonly documentExtractionService: DocumentExtractionService,
  ) {}

  /**
   * Trigger (or refresh) extraction on a file. Accepts an optional
   * `hint` so the caller can tell us what kind of document this is —
   * the model still tries to verify, but a hint produces faster/cleaner
   * results.
   */
  @Post('files/:fileId/extract')
  extract(
    @Param('fileId') fileId: string,
    @Body()
    body: { force?: boolean; hint?: ExtractionDocumentType },
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentExtractionService.extractFromFile(
      fileId,
      user.userId,
      body || {},
    );
  }

  @Get('files/:fileId')
  get(@Param('fileId') fileId: string) {
    return this.documentExtractionService.getForFile(fileId);
  }
}
