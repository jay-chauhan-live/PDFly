import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSmtpConfigDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;

  @IsString() @MinLength(1) @MaxLength(253) host!: string;

  @IsInt() @Min(1) @Max(65535) port!: number;

  /** True for implicit TLS (465); false for STARTTLS on 587 or 25. */
  @IsOptional() @IsBoolean() secure?: boolean;

  @IsOptional() @IsString() @MaxLength(320) username?: string;

  /** Write-only. Encrypted at rest and never returned (PLAN §4, §7). */
  @IsOptional() @IsString() @MaxLength(500) password?: string;

  @IsEmail() @MaxLength(320) fromEmail!: string;

  @IsOptional() @IsString() @MaxLength(120) fromName?: string;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateSmtpConfigDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(253) host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() @MaxLength(320) username?: string;

  /** Omit to keep the stored password; send a new one to replace it. */
  @IsOptional() @IsString() @MaxLength(500) password?: string;

  @IsOptional() @IsEmail() @MaxLength(320) fromEmail?: string;
  @IsOptional() @IsString() @MaxLength(120) fromName?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class TestSmtpConfigDto {
  /** Send a real message here as well as checking the connection. */
  @IsOptional() @IsEmail() @MaxLength(320) to?: string;
}
