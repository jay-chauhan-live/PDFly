import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
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

const WATERMARK_POSITIONS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;

export class WatermarkDto {
  @IsIn(['text', 'image']) type!: 'text' | 'image';

  @IsOptional() @IsString() @MaxLength(200) text?: string;

  /** PNG or JPEG, as raw base64 or a data URI. Asset references land with §6 assets. */
  @IsOptional() @IsString() @MaxLength(8 * 1024 * 1024) imageBase64?: string;

  @IsOptional() @IsNumber() @Min(0.01) @Max(1) opacity?: number;
  @IsOptional() @IsNumber() @Min(-360) @Max(360) rotation?: number;
  @IsOptional() @IsInt() @Min(4) @Max(400) fontSize?: number;

  /** Width as a fraction of the page, for image watermarks. */
  @IsOptional() @IsNumber() @Min(0.01) @Max(2) scale?: number;

  @IsOptional()
  @Matches(/^#?[0-9a-fA-F]{6}$/, { message: 'color must be #rrggbb' })
  color?: string;

  @IsOptional() @IsIn(WATERMARK_POSITIONS) position?: (typeof WATERMARK_POSITIONS)[number];

  /** `all`, `first`, `last`, or a list like `1-3,7` (PLAN §6). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^(all|first|last|\d+(-\d+)?(\s*,\s*\d+(-\d+)?)*)$/, {
    message: 'pages must be "all", "first", "last", or a list like "1-3,7"',
  })
  pages?: string;
}

export class PermissionsDto {
  @IsOptional() @IsBoolean() print?: boolean;
  @IsOptional() @IsBoolean() highResolutionPrint?: boolean;
  @IsOptional() @IsBoolean() modify?: boolean;
  @IsOptional() @IsBoolean() copy?: boolean;
  @IsOptional() @IsBoolean() annotate?: boolean;
  @IsOptional() @IsBoolean() fillForms?: boolean;
  @IsOptional() @IsBoolean() assemble?: boolean;
}

/**
 * Passwords arrive here, live in memory for the duration of the render, and
 * are gone (PLAN §3). Nothing in this class is ever persisted: the pipeline
 * strips the whole block before writing `options_json`, and the logger
 * redacts it by path.
 */
export class ProtectionDto {
  /** Required to open the document. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) userPassword?: string;

  /** Required to change permissions. Generated and discarded when omitted. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) ownerPassword?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PermissionsDto)
  permissions?: PermissionsDto;
}

export class RenderPdfDto {
  @IsString()
  html!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RenderOptionsDto)
  options?: RenderOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WatermarkDto)
  watermark?: WatermarkDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProtectionDto)
  protection?: ProtectionDto;

  /** `url` returns JSON with a signed link, `binary` streams the PDF back. */
  @IsOptional() @IsIn(['url', 'binary', 'base64']) output?: 'url' | 'binary' | 'base64';

  /** Async renders only: where to POST the signed completion event (PLAN §6). */
  @IsOptional() @IsString() @MaxLength(2048) webhookUrl?: string;

  @IsOptional() @IsString() @MaxLength(255) filename?: string;

  @IsOptional() @IsString() @MaxLength(255) title?: string;
}
