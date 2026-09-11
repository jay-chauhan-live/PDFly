import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * A deliberately simple policy: length does more for password strength than
 * composition rules, which mostly push people toward predictable patterns.
 */
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: `password must be at least ${PASSWORD_MIN} characters` })
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Organization name. Defaults to the person's name when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationName?: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['system', 'light', 'dark'])
  themePref?: 'system' | 'light' | 'dark';
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: `password must be at least ${PASSWORD_MIN} characters` })
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class SlugDto {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(60)
  slug!: string;
}
