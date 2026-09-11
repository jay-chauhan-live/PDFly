import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DOCUMENT_STATUSES = ['queued', 'rendering', 'completed', 'failed', 'expired'] as const;

export const DOCUMENT_SOURCES = ['api', 'ui'] as const;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export class ListDocumentsDto {
  /**
   * Matched against the title as a substring, case-insensitively — the right
   * behaviour for a search-as-you-type box over short titles, where someone
   * typing "inv" expects "invoice-001" back.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  status?: (typeof DOCUMENT_STATUSES)[number];

  @IsOptional()
  @IsIn(DOCUMENT_SOURCES)
  source?: (typeof DOCUMENT_SOURCES)[number];

  /** Inclusive lower bound on `createdAt`. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Exclusive upper bound on `createdAt`. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  /** Opaque; comes from the previous page's `nextCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
