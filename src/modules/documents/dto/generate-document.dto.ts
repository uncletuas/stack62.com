import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export type DocumentFormat =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'pdf'
  | 'png'
  | 'md'
  | 'txt';

export interface DocumentSpecBlock {
  type:
    | 'heading'
    | 'paragraph'
    | 'bullets'
    | 'numbered'
    | 'table'
    | 'image'
    | 'pageBreak'
    | 'slide';
  level?: number;
  text?: string;
  items?: string[];
  rows?: string[][];
  src?: string;
  title?: string;
  body?: string;
}

export class GenerateDocumentDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsIn(['docx', 'xlsx', 'pptx', 'pdf', 'png', 'md', 'txt'])
  format!: DocumentFormat;

  @IsString()
  @MaxLength(255)
  title!: string;

  /**
   * Either supply `blocks` for a structured document or `prompt` to have the
   * AI draft the structure first (server will call OpenRouter and then render).
   */
  @IsOptional()
  @IsArray()
  blocks?: DocumentSpecBlock[];

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /** Optional model override for prompt-driven generation. */
  @IsOptional()
  @IsString()
  model?: string;
}
