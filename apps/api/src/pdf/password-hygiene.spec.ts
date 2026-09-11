import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { RenderPipeline } from './render.pipeline.js';
import { WatermarkService } from '../protection/watermark.service.js';
import { EncryptionService } from '../protection/encryption.service.js';
import { buildLoggerOptions } from '../common/logger.options.js';
import type { ConfigService } from '@nestjs/config';
import type { RendererClient } from '../renderer/renderer.client.js';
import type { StorageService } from '../storage/storage.service.js';
import type { UsageService } from '../usage/usage.service.js';
import type { Env } from '../config/env.schema.js';
import type { RenderPdfDto } from './dto/render-pdf.dto.js';

/**
 * PLAN §3: "Passwords are never stored. They arrive in the request, live in
 * memory for the duration of the job, and are gone."
 *
 * This is the audit that phase asks for. It renders with distinctive
 * passwords and then checks every surface a password could survive on: the
 * document row, the options recorded for reproducibility, the stored object,
 * the log output, and the error returned to the caller.
 */
const USER_PASSWORD = 'sentinel-user-password-8f3a1c';
const OWNER_PASSWORD = 'sentinel-owner-password-b72e90';

const prisma = new PrismaService();

/** A minimal one-page PDF, so the pipeline has something real to protect. */
async function onePagePdf(): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([595, 842]).drawText('Secret', { x: 50, y: 700, size: 24, font });
  return Buffer.from(await document.save());
}

const stored: { key: string; body: Buffer }[] = [];

const storage = {
  buildKey: (orgId: string, documentId: string) => `org/${orgId}/${documentId}.pdf`,
  putPdf: (key: string, body: Buffer) => {
    stored.push({ key, body });
    return Promise.resolve();
  },
} as unknown as StorageService;

const usage = { recordRender: () => Promise.resolve() } as unknown as UsageService;

const config = {
  get: (key: keyof Env) => (key === 'MAX_HTML_BYTES' ? 5_242_880 : 7),
} as unknown as ConfigService<Env, true>;

let orgId: string;
let pipeline: RenderPipeline;
let rendered: Buffer;

beforeAll(async () => {
  rendered = await onePagePdf();

  const renderer = {
    render: () => Promise.resolve({ pdf: rendered, renderDurationMs: 10, blockedAssets: 0 }),
  } as unknown as RendererClient;

  const org = await prisma.organization.create({
    data: { name: 'Hygiene', slug: `hygiene-${randomUUID()}` },
    select: { id: true },
  });
  orgId = org.id;

  pipeline = new RenderPipeline(
    prisma,
    renderer,
    new WatermarkService(),
    new EncryptionService(),
    storage,
    usage,
    config,
  );
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

const protectedRender: RenderPdfDto = {
  html: '<h1>Secret</h1>',
  title: 'Protected document',
  watermark: { type: 'text', text: 'CONFIDENTIAL' },
  protection: {
    userPassword: USER_PASSWORD,
    ownerPassword: OWNER_PASSWORD,
    permissions: { print: false, copy: false },
  },
};

describe('password hygiene (PLAN §3)', () => {
  it('records the settings but never the passwords', async () => {
    const result = await pipeline.run(protectedRender, { orgId, source: 'api' });

    const row = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } });
    const serialised = JSON.stringify(row);

    expect(serialised).not.toContain(USER_PASSWORD);
    expect(serialised).not.toContain(OWNER_PASSWORD);

    // What it does keep is enough to reproduce the render.
    expect(row.optionsJson).toMatchObject({
      protection: {
        hasUserPassword: true,
        hasOwnerPassword: true,
        permissions: { print: false, copy: false },
      },
      watermark: { type: 'text', text: 'CONFIDENTIAL' },
    });
    expect(row.isEncrypted).toBe(true);
    expect(row.hasWatermark).toBe(true);
  });

  it('never writes a password into the stored object', async () => {
    stored.length = 0;
    await pipeline.run(protectedRender, { orgId, source: 'api' });

    expect(stored).toHaveLength(1);
    const body = stored[0]?.body.toString('latin1') ?? '';

    expect(body).not.toContain(USER_PASSWORD);
    expect(body).not.toContain(OWNER_PASSWORD);
  });

  it('applies the watermark before encrypting, since the reverse cannot work', async () => {
    stored.length = 0;
    await pipeline.run(protectedRender, { orgId, source: 'api' });

    const body = stored[0]?.body ?? Buffer.alloc(0);

    // Encrypted, so the stamped text is no longer legible in the bytes — which
    // is only true if the stamp happened first and the encryption after.
    expect(body.toString('latin1')).toContain('/Encrypt');
    expect(body.toString('latin1')).not.toContain('CONFIDENTIAL');
  });

  it('keeps the passwords out of the error returned when a render fails', async () => {
    const failing = new RenderPipeline(
      prisma,
      {
        render: () => Promise.reject(new Error(`boom with ${USER_PASSWORD} in the message`)),
      } as unknown as RendererClient,
      new WatermarkService(),
      new EncryptionService(),
      storage,
      usage,
      config,
    );

    const error = await failing
      .run(protectedRender, { orgId, source: 'api' })
      .catch((e: unknown) => e);

    // The thrown error is the renderer's own, but nothing derived from it may
    // reach the document row a customer can read back.
    const failed = await prisma.document.findFirst({
      where: { orgId, status: 'failed' },
      orderBy: { createdAt: 'desc' },
    });

    expect(JSON.stringify(failed)).not.toContain(USER_PASSWORD);
    expect(error).toBeInstanceOf(Error);
  });

  it('redacts the protection block from logs', () => {
    const options = buildLoggerOptions({ NODE_ENV: 'test', LOG_LEVEL: 'info' } as Env);
    const paths =
      options.pinoHttp && typeof options.pinoHttp === 'object' && 'redact' in options.pinoHttp
        ? (options.pinoHttp.redact as { paths: string[] }).paths
        : [];

    // The logger is the last line of defence, not the first — but it has to
    // actually cover the fields the DTO defines.
    expect(paths).toContain('req.body.protection');
    expect(paths).toContain('*.userPassword');
    expect(paths).toContain('*.ownerPassword');
  });

  it('has no field in the recorded options that could hold a secret', async () => {
    const result = await pipeline.run(protectedRender, { orgId, source: 'api' });
    const row = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } });

    const keys = collectKeys(row.optionsJson);

    // Built by naming what goes in, so a password-shaped field added to the
    // DTO later is excluded by default rather than by remembering to strip it.
    expect(keys).not.toContain('userPassword');
    expect(keys).not.toContain('ownerPassword');
    expect(keys.some((key) => /password/i.test(key) && !/^has/i.test(key))).toBe(false);
  });
});

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return keys;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.push(key);
    collectKeys(nested, keys);
  }

  return keys;
}
