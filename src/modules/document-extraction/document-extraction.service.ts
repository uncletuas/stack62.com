import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { FilesService } from '../files/files.service';
import {
  DocumentExtractionEntity,
  ExtractionDocumentType,
} from './entities/document-extraction.entity';

/**
 * Vision-LLM-driven document extraction.
 *
 * For images (jpg/png/webp/heic) and single-page PDFs we send the file
 * directly to a vision-capable Claude or GPT-4o model via OpenRouter.
 * The prompt asks for a structured JSON payload tailored to the
 * detected document type (receipt / invoice / letter / form / id /
 * business_card). Multi-page PDFs are punted for now — we extract the
 * first page only with a note in metadata.
 *
 * Required env:
 *   - OPENROUTER_API_KEY (or ANTHROPIC_API_KEY directly — see below)
 *   - VISION_MODEL (default: "anthropic/claude-3.5-sonnet")
 */
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  constructor(
    @InjectRepository(DocumentExtractionEntity)
    private readonly extractionsRepo: Repository<DocumentExtractionEntity>,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService,
    private readonly activityService: ActivityService,
  ) {}

  /** Returns existing extraction if completed, otherwise re-runs. */
  async extractFromFile(
    fileId: string,
    actorUserId: string,
    options: { force?: boolean; hint?: ExtractionDocumentType } = {},
  ): Promise<DocumentExtractionEntity> {
    const file = await this.filesService.findOne(fileId, actorUserId);

    let row = await this.extractionsRepo.findOne({ where: { fileId } });
    if (row && !options.force && row.status === 'completed') {
      return row;
    }

    if (!row) {
      row = await this.extractionsRepo.save(
        this.extractionsRepo.create({
          fileId,
          organizationId: file.organizationId,
          workspaceId: file.workspaceId,
          status: 'extracting',
          documentType: options.hint ?? 'unknown',
        }),
      );
    } else {
      row.status = 'extracting';
      row.errorMessage = null;
      await this.extractionsRepo.save(row);
    }

    try {
      const buffer = await this.filesService.getBuffer(file);
      const mediaType = this.normalizeMediaType(file.mimeType, file.filename);
      if (!mediaType) {
        throw new BadRequestException(
          `File type "${file.mimeType}" cannot be visually extracted yet. Supported: image/png, image/jpeg, image/webp, application/pdf.`,
        );
      }
      const { documentType, extractedFields, rawText, confidence, modelUsed } =
        await this.callVisionModel(buffer, mediaType, options.hint);

      row.status = 'completed';
      row.documentType = documentType;
      row.extractedFields = extractedFields;
      row.rawText = rawText;
      row.confidence = confidence;
      row.modelUsed = modelUsed;
      row.extractedAt = new Date();
      row = await this.extractionsRepo.save(row);

      await this.activityService.log({
        organizationId: file.organizationId,
        workspaceId: file.workspaceId ?? null,
        actorUserId,
        action: 'document.extract',
        targetType: 'file',
        targetId: file.id,
        origin: 'user',
        metadata: { documentType, modelUsed, confidence },
      });

      return row;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      row.status = 'failed';
      row.errorMessage = message;
      await this.extractionsRepo.save(row);
      throw err;
    }
  }

  async getForFile(fileId: string): Promise<DocumentExtractionEntity | null> {
    return this.extractionsRepo.findOne({ where: { fileId } });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private normalizeMediaType(mime: string, filename: string): string | null {
    const lower = filename.toLowerCase();
    if (mime?.startsWith('image/')) return mime;
    if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return null;
  }

  private async callVisionModel(
    buffer: Buffer,
    mediaType: string,
    hint?: ExtractionDocumentType,
  ): Promise<{
    documentType: ExtractionDocumentType;
    extractedFields: Record<string, unknown>;
    rawText: string;
    confidence: number;
    modelUsed: string;
  }> {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Document extraction needs an LLM provider. Set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) on the API service.',
      );
    }
    const model =
      this.configService.get<string>('VISION_MODEL') ||
      'anthropic/claude-3.5-sonnet';

    const dataUrl = `data:${mediaType};base64,${buffer.toString('base64')}`;
    const userPrompt = buildPrompt(hint);

    const body = {
      model,
      max_tokens: 1500,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise document analyst. Always return a single valid JSON object — no prose, no markdown fences. If a field is unclear, return null. Numbers must be numbers, dates must be ISO-8601 (YYYY-MM-DD) when possible.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    };

    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            this.configService.get<string>('OPENROUTER_HTTP_REFERER') ||
            'https://stack62.com',
          'X-Title': 'Stack62 Document Extraction',
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`OpenRouter vision call failed: ${text}`);
      throw new Error(`Vision model call failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content || '';
    const parsed = parseJsonStrict(content);

    return {
      documentType: (parsed.documentType ||
        hint ||
        'unknown') as ExtractionDocumentType,
      extractedFields: (parsed.fields || {}) as Record<string, unknown>,
      rawText: typeof parsed.rawText === 'string' ? parsed.rawText : content,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      modelUsed: model,
    };
  }
}

function buildPrompt(hint?: ExtractionDocumentType): string {
  const examples = `
Examples of the expected output:

Receipt:
{
  "documentType": "receipt",
  "fields": {
    "vendor": "Office Depot",
    "vendorAddress": "...",
    "date": "2026-04-12",
    "lineItems": [{ "description": "Pens", "quantity": 2, "unitPrice": 4.5, "total": 9.0 }],
    "subtotal": 9.0,
    "tax": 0.72,
    "total": 9.72,
    "currency": "USD",
    "paymentMethod": "Visa ****1234"
  },
  "rawText": "<full readable text of the document>",
  "confidence": 0.94
}

Invoice:
{
  "documentType": "invoice",
  "fields": {
    "vendor": "Acme Co.",
    "invoiceNumber": "INV-2026-0412",
    "date": "2026-04-01",
    "dueDate": "2026-05-01",
    "billTo": { "name": "...", "address": "..." },
    "lineItems": [...],
    "subtotal": ...,
    "tax": ...,
    "total": ...,
    "currency": "USD"
  },
  ...
}

Letter:
{ "documentType": "letter", "fields": { "sender": "...", "recipient": "...", "date": "...", "subject": "...", "summary": "..." }, ... }

ID card:
{ "documentType": "id_card", "fields": { "fullName": "...", "idNumber": "...", "dateOfBirth": "...", "expiresAt": "..." }, ... }

Business card:
{ "documentType": "business_card", "fields": { "fullName": "...", "company": "...", "title": "...", "email": "...", "phone": "...", "address": "..." }, ... }

Form (generic):
{ "documentType": "form", "fields": { "<labelInCamelCase>": "<value>" }, ... }
`;
  return `Extract the structured content from this document.${
    hint ? ` It is a ${hint}.` : ''
  }

Return JSON with this shape:
{
  "documentType": "receipt" | "invoice" | "letter" | "contract" | "id_card" | "business_card" | "form" | "unknown",
  "fields": { ... }, // shape depends on documentType
  "rawText": "<full plain text of the document>",
  "confidence": <0..1>
}

${examples}

Now extract the document below.`;
}

/**
 * Strict JSON parse that tolerates a model occasionally wrapping its
 * answer in ```json fences despite our instructions.
 */
function parseJsonStrict(content: string): Record<string, unknown> {
  if (!content) return {};
  let trimmed = content.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Fallback: pick the largest JSON-looking substring.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        /* swallow */
      }
    }
    return {};
  }
}
