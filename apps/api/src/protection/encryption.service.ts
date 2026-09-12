import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProblemError } from '../common/errors/problem.js';
import type { ProtectionDto } from '../pdf/dto/render-pdf.dto.js';

/** Long enough that a stuck qpdf cannot hold a request open indefinitely. */
const QPDF_TIMEOUT_MS = 30_000;

/** qpdf exits 3 for warnings, which still produce a usable file. */
const QPDF_WARNING_EXIT = 3;

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private available: boolean | null = null;

  /**
   * AES-256 with individually settable permission bits (PLAN §3).
   *
   * pdf-lib cannot encrypt and Chromium's `printToPDF` has no encryption
   * support at all, which is exactly why this step exists outside the browser.
   */
  /** Overridable so a test can watch a directory nothing else writes to. */
  protected tempRoot(): string {
    return tmpdir();
  }

  async encrypt(pdf: Buffer, protection: ProtectionDto): Promise<Buffer> {
    const directory = await mkdtemp(join(this.tempRoot(), 'pdfly-'));
    const input = join(directory, 'in.pdf');

    try {
      // 0600: the unencrypted PDF is on disk for the length of one qpdf run,
      // and no other user on the host has any business reading it.
      await writeFile(input, pdf, { mode: 0o600 });

      const output = await this.run(input, this.buildArguments(protection));

      this.logger.debug(`encrypted ${pdf.byteLength} bytes to ${output.byteLength}`);

      return output;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  /** Surfaced by the health check: a missing binary fails every protected render. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    this.available = await new Promise<boolean>((resolve) => {
      execFile('qpdf', ['--version'], { timeout: 5000 }, (error) => resolve(!error));
    });

    if (!this.available) {
      this.logger.error('qpdf is not on PATH; password protection will fail');
    }

    return this.available;
  }

  /**
   * Arguments go to qpdf over stdin via its `@-` argument file syntax.
   *
   * The obvious thing — putting them on the command line — publishes both
   * passwords to anything that can read the process table, which is every
   * user on the host and every `ps` in a container. They would also land in
   * any shell history or process-level audit log. stdin keeps them in a pipe
   * between two processes and nowhere else.
   */
  private run(input: string, encryptArguments: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'qpdf',
        ['@-'],
        { timeout: QPDF_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' },
        (error, stdout, stderr) => {
          const code = (error as (NodeJS.ErrnoException & { code?: number }) | null)?.code;

          if (error && code !== QPDF_WARNING_EXIT) {
            const message = stderr.toString('utf8').trim();

            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(
                new ProblemError(
                  'internal_error',
                  500,
                  'Password protection is unavailable: qpdf is not installed',
                ),
              );
              return;
            }

            this.logger.error(`qpdf failed: ${message}`);
            // qpdf's own message is not returned to the caller: it echoes the
            // arguments it was given, which include the passwords.
            reject(new ProblemError('internal_error', 500, 'Could not encrypt the document'));
            return;
          }

          resolve(Buffer.from(stdout));
        },
      );

      // One argument per line, terminated — qpdf reads until end of input.
      child.stdin?.end(`${[input, ...encryptArguments, '-'].join('\n')}\n`);
    });
  }

  private buildArguments(protection: ProtectionDto): string[] {
    const userPassword = protection.userPassword ?? '';

    // An owner password left unset would make the permission bits trivially
    // removable, and qpdf refuses the combination outright without
    // --allow-insecure. Generating one and throwing it away is the honest
    // reading of "restrict this document": nobody, including us, can lift the
    // restrictions afterwards.
    const ownerPassword = protection.ownerPassword ?? randomBytes(32).toString('base64url');

    const permissions = protection.permissions ?? {};

    // qpdf's traditional --encrypt syntax: user password, owner password and
    // key length are positional, in that order, then the restriction flags and
    // a closing --. The named-flag form (--user-password=, --owner-password=,
    // --bits=) only exists in qpdf >= 11.7; Debian bookworm ships 11.3, so the
    // positional form is used for portability. Newer qpdf still accepts it. An
    // empty user password is a legitimate value (restrict-only, no open
    // password) and survives as an empty token in the @- argument file.
    const args = ['--encrypt', userPassword, ownerPassword, '256'];

    // Printing is a three-state permission, not a boolean: a document can
    // allow a low-resolution proof print but not a press-quality one.
    if (permissions.print === false) {
      args.push('--print=none');
    } else if (permissions.highResolutionPrint === false) {
      args.push('--print=low');
    } else {
      args.push('--print=full');
    }

    args.push(`--modify-other=${yesNo(permissions.modify)}`);
    args.push(`--extract=${yesNo(permissions.copy)}`);
    args.push(`--annotate=${yesNo(permissions.annotate)}`);
    args.push(`--form=${yesNo(permissions.fillForms)}`);
    args.push(`--assemble=${yesNo(permissions.assemble)}`);
    args.push('--');

    return args;
  }
}

/** Permissions default to allowed; only an explicit `false` restricts. */
function yesNo(value: boolean | undefined): 'y' | 'n' {
  return value === false ? 'n' : 'y';
}
