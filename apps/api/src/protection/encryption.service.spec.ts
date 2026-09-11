import type * as ChildProcess from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Records what actually reaches argv while still running the real qpdf.
 *
 * The process table is readable by every other process on the host, so a
 * password passed as a command-line argument is a password disclosed. This
 * wrapper is the only way to assert that it never happens.
 */
const argv = vi.hoisted(() => [] as string[][]);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();

  return {
    ...actual,
    execFile: (file: string, args: string[], ...rest: unknown[]) => {
      argv.push([file, ...args]);
      return (actual.execFile as unknown as (...a: unknown[]) => unknown)(file, args, ...rest);
    },
  };
});

const { EncryptionService } = await import('./encryption.service.js');

// The helpers below drive qpdf themselves and must not go through the wrapper:
// promisify only understands the real export's callback contract.
const { execFile: realExecFile } = await vi.importActual<typeof ChildProcess>('node:child_process');

/**
 * Against the real qpdf binary. Encryption is the binary's behaviour, not
 * ours: a mocked qpdf would prove only that we can build an argument list.
 * Install it with `brew install qpdf` or `apt install qpdf`.
 */
const run = promisify(realExecFile);

let scratch: string;

/** Same service, pointed at a directory only this spec writes to. */
class ScratchEncryptionService extends EncryptionService {
  protected override tempRoot(): string {
    return scratch;
  }
}

const service = new ScratchEncryptionService();

let workdir: string;
let plain: Buffer;

async function toFile(pdf: Buffer, name: string): Promise<string> {
  const file = join(workdir, `${name}-${Math.random().toString(36).slice(2)}.pdf`);
  await writeFile(file, pdf);
  return file;
}

/** The encryption dictionary as qpdf reports it. */
async function inspect(pdf: Buffer, password?: string): Promise<string> {
  const file = await toFile(pdf, 'probe');
  const args = [
    ...(password === undefined ? [] : [`--password=${password}`]),
    '--show-encryption',
    file,
  ];

  const { stdout, stderr } = await run('qpdf', args).catch(
    (error: { stdout?: string; stderr?: string }) => ({
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }),
  );

  return `${stdout}${stderr}`;
}

/**
 * qpdf's `--requires-password` reports through the exit code: 0 means a
 * password is needed, 2 means the file is not encrypted at all.
 */
async function requiresPassword(pdf: Buffer): Promise<boolean> {
  const file = await toFile(pdf, 'needs');

  const code = await run('qpdf', ['--requires-password', file]).then(
    () => 0,
    (error: { code?: number }) => error.code ?? -1,
  );

  return code === 0;
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'pdfly-spec-'));
  scratch = await mkdtemp(join(tmpdir(), 'pdfly-scratch-'));

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([595, 842]).drawText('Confidential contents', { x: 60, y: 700, size: 18, font });

  plain = Buffer.from(await document.save());
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

describe('EncryptionService', () => {
  it('finds qpdf on PATH', async () => {
    expect(await service.isAvailable()).toBe(true);
  });

  it('produces a document that cannot be opened without the password', async () => {
    const encrypted = await service.encrypt(plain, { userPassword: 'open sesame' });

    expect(await requiresPassword(plain)).toBe(false);
    expect(await requiresPassword(encrypted)).toBe(true);
  });

  it('uses AES-256, not one of the broken legacy handlers', async () => {
    const encrypted = await service.encrypt(plain, { userPassword: 'open sesame' });

    const description = await inspect(encrypted, 'open sesame');

    // R = 6 is the AES-256 handler; anything lower is one of the formats
    // qpdf itself calls insecure.
    expect(description).toMatch(/R = 6/);
    expect(description).toMatch(/file encryption method: AESv3/);
  });

  it('opens with the right password and refuses the wrong one', async () => {
    const encrypted = await service.encrypt(plain, { userPassword: 'correct password' });
    const file = await toFile(encrypted, 'roundtrip');

    await expect(
      run('qpdf', ['--password=correct password', '--decrypt', file, '-']),
    ).resolves.toBeDefined();

    await expect(run('qpdf', ['--password=wrong', '--decrypt', file, '-'])).rejects.toBeDefined();
  });

  it('applies each permission bit individually', async () => {
    const encrypted = await service.encrypt(plain, {
      userPassword: 'pw',
      permissions: {
        print: true,
        highResolutionPrint: false,
        modify: false,
        copy: false,
        annotate: false,
        fillForms: true,
        assemble: false,
      },
    });

    const description = await inspect(encrypted, 'pw');

    // Printing is three-state: allowed, but only at low resolution.
    expect(description).toMatch(/print low resolution: allowed/i);
    expect(description).toMatch(/print high resolution: not allowed/i);
    expect(description).toMatch(/extract for any purpose: not allowed/i);
    expect(description).toMatch(/modify annotations: not allowed/i);
    expect(description).toMatch(/modify forms: allowed/i);
    expect(description).toMatch(/modify document assembly: not allowed/i);
  });

  it('allows everything that was not explicitly restricted', async () => {
    const encrypted = await service.encrypt(plain, { userPassword: 'pw', permissions: {} });

    const description = await inspect(encrypted, 'pw');

    expect(description).toMatch(/extract for any purpose: allowed/i);
    expect(description).toMatch(/modify document assembly: allowed/i);
    expect(description).toMatch(/print high resolution: allowed/i);
  });

  it('restricts without an open password when only permissions are given', async () => {
    // "Anyone may read this, nobody may print it" is a legitimate request.
    const encrypted = await service.encrypt(plain, { permissions: { print: false } });

    expect(await requiresPassword(encrypted)).toBe(false);
    expect(await inspect(encrypted)).toMatch(/print low resolution: not allowed/i);
  });

  it('never lets a password reach the command line', async () => {
    argv.length = 0;

    await service.encrypt(plain, {
      userPassword: 'a very secret user password',
      ownerPassword: 'a very secret owner password',
    });

    const qpdfCalls = argv.filter(([command]) => command === 'qpdf');
    expect(qpdfCalls.length).toBeGreaterThan(0);

    const flattened = JSON.stringify(qpdfCalls);
    expect(flattened).not.toContain('secret user password');
    expect(flattened).not.toContain('secret owner password');

    // Exactly one argument, and it means "read the rest from stdin".
    expect(qpdfCalls.at(-1)).toEqual(['qpdf', '@-']);
  });

  it('leaves no temporary file behind holding the unencrypted document', async () => {
    // The intermediate file holds the document before encryption. Leaving one
    // in a world-readable temp directory would undo the whole point.
    expect(await readdir(scratch)).toEqual([]);

    await service.encrypt(plain, { userPassword: 'pw' });

    expect(await readdir(scratch)).toEqual([]);
  });
});
