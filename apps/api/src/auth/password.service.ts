import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id password hashing (PLAN §5).
 *
 * Parameters follow the OWASP recommendation rather than the library
 * defaults: 19 MiB of memory and two iterations. Argon2id specifically,
 * because it resists both GPU cracking and side-channel attacks.
 */
@Injectable()
export class PasswordService {
  private readonly options = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, this.options);
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      // A malformed stored hash must read as "wrong password", never as an error
      // that distinguishes one account from another.
      return false;
    }
  }
}
