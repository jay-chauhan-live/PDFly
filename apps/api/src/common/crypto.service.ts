import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.schema.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM against a key from the environment, never from the database
 * (PLAN §4).
 *
 * GCM rather than CBC because it authenticates as well as encrypts: a
 * ciphertext altered in the database or in Redis fails to decrypt instead of
 * quietly producing different plaintext. Every call gets a fresh random IV,
 * and the IV and tag travel with the ciphertext — they are not secrets, and
 * storing them separately only invites losing one.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.key = Buffer.from(config.get('ENCRYPTION_KEY', { infer: true }), 'base64');
  }

  /** `<iv>.<tag>.<ciphertext>`, all base64url. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  decrypt(payload: string): string {
    const [iv, tag, ciphertext] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));

    if (!iv || !tag || !ciphertext || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('Malformed ciphertext');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);

    // Throws if the tag does not verify, which is the point.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
