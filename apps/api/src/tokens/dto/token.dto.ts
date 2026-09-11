import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SCOPES, type Scope } from '../scopes.js';

export class CreateTokenDto {
  /** Names are for humans deciding which token to revoke. */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ArrayNotEmpty({ message: 'a token with no scopes could not do anything' })
  @ArrayMaxSize(SCOPES.length)
  @IsIn(SCOPES, { each: true })
  scopes!: Scope[];

  /** Optional; a token with no expiry lives until it is revoked. */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
