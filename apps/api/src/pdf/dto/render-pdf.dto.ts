import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const PAGE_FORMATS = [
  'Letter',
  'Legal',
  'Tabloid',
  'Ledger',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
] as const;

export class MarginDto {
  @IsOptional() @IsString() top?: string;
  @IsOptional() @IsString() right?: string;
  @IsOptional() @IsString() bottom?: string;
  @IsOptional() @IsString() left?: string;
}

export class RenderOptionsDto {
  @IsOptional() @IsIn(PAGE_FORMATS) format?: (typeof PAGE_FORMATS)[number];
  @IsOptional() @IsString() width?: string;
  @IsOptional() @IsString() height?: string;
  @IsOptional() @IsBoolean() landscape?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => MarginDto)
  margin?: MarginDto;

  @IsOptional() @IsBoolean() printBackground?: boolean;

  @IsOptional() @IsNumber() @Min(0.1) @Max(2) scale?: number;

  @IsOptional() @IsString() @MaxLength(4096) headerTemplate?: string;
  @IsOptional() @IsString() @MaxLength(4096) footerTemplate?: string;

  @IsOptional()
  @IsIn(['load', 'domcontentloaded', 'networkidle', 'commit'])
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

  @IsOptional() @IsInt() @Min(1000) @Max(60000) timeoutMs?: number;

  /** Off by default — every script that runs is caller-supplied code (PLAN §11). */
  @IsOptional() @IsBoolean() javascript?: boolean;

  /** Default posture is inline and uploaded assets only (PLAN §11). */
  @IsOptional() @IsBoolean() allowExternalAssets?: boolean;

  @IsOptional() @IsArray() @IsString({ each: true }) assetHostAllowlist?: string[];
}

export class RenderPdfDto {
  @IsString()
  html!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RenderOptionsDto)
  options?: RenderOptionsDto;

  /**
   * `url` returns JSON with a signed link, `binary` streams the PDF back.
   * Watermarking and protection arrive in Phase 5.
   */
  @IsOptional() @IsIn(['url', 'binary', 'base64']) output?: 'url' | 'binary' | 'base64';

  @IsOptional() @IsString() @MaxLength(255) filename?: string;

  @IsOptional() @IsString() @MaxLength(255) title?: string;
}
