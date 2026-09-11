import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from './documents.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';

/**
 * Exercised against the real database.
 *
 * What matters here is what Postgres does — org scoping, keyset ordering,
 * case-insensitive substring search — none of which a mocked Prisma client
 * would actually test. Run `pnpm infra:up` first; CI provides Postgres.
 */
const prisma = new PrismaService();

const deleted: string[] = [];
const storage = {
  signedDownloadUrl: (key: string, filename?: string) =>
    Promise.resolve(`https://storage.example/${key}?filename=${filename ?? ''}`),
  deletePdf: (key: string) => {
    deleted.push(key);
    return Promise.resolve();
  },
} as unknown as StorageService;

const service = new DocumentsService(prisma, storage);

let orgId: string;
let otherOrgId: string;
let userId: string;

/** Rows are written with fixed timestamps so ordering assertions are exact. */
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes, 0));

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Test', slug: `test-${randomUUID()}` },
    select: { id: true },
  });
  const other = await prisma.organization.create({
    data: { name: 'Other', slug: `other-${randomUUID()}` },
    select: { id: true },
  });

  orgId = org.id;
  otherOrgId = other.id;

  const user = await prisma.user.create({
    data: {
      orgId,
      email: `${randomUUID()}@example.com`,
      passwordHash: 'x',
      name: 'Tester',
    },
    select: { id: true },
  });
  userId = user.id;

  await prisma.document.createMany({
    data: [
      {
        orgId,
        createdBy: userId,
        source: 'ui',
        status: 'completed',
        title: 'Invoice-001',
        storageKey: 'org/x/one.pdf',
        pageCount: 1,
        byteSize: 1000,
        createdAt: at(1),
      },
      {
        orgId,
        source: 'api',
        status: 'completed',
        title: 'invoice-002',
        storageKey: 'org/x/two.pdf',
        pageCount: 2,
        byteSize: 2000,
        createdAt: at(2),
      },
      {
        orgId,
        source: 'api',
        status: 'failed',
        title: 'Statement',
        errorCode: 'render_timeout',
        createdAt: at(3),
      },
      {
        orgId,
        source: 'ui',
        status: 'completed',
        title: 'Receipt',
        storageKey: 'org/x/four.pdf',
        createdAt: at(4),
      },
    ],
  });

  // The neighbouring tenant, which must be invisible throughout.
  await prisma.document.create({
    data: {
      orgId: otherOrgId,
      source: 'api',
      status: 'completed',
      title: 'Invoice-999',
      storageKey: 'org/other/secret.pdf',
      createdAt: at(5),
    },
  });
});

afterAll(async () => {
  // Documents and users cascade from the organization.
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
});

describe('DocumentsService.list', () => {
  it('returns only the caller’s organization, newest first', async () => {
    const page = await service.list(orgId, {});
    const titles = (page.data as { title: string }[]).map((d) => d.title);

    expect(titles).toEqual(['Receipt', 'Statement', 'invoice-002', 'Invoice-001']);
    expect(titles).not.toContain('Invoice-999');
  });

  it('pages with a cursor, without repeating or skipping a row', async () => {
    const first = await service.list(orgId, { limit: 2 });
    expect(first.nextCursor).toBeDefined();

    const second = await service.list(orgId, { limit: 2, cursor: first.nextCursor });

    const ids = [...first.data, ...second.data].map((d) => (d as { id: string }).id);
    expect(new Set(ids).size).toBe(4);
    // The last page says so, rather than leaving the caller to ask again.
    expect(second.nextCursor).toBeUndefined();
  });

  it('matches a title substring case-insensitively', async () => {
    const page = await service.list(orgId, { search: 'inv' });
    const titles = (page.data as { title: string }[]).map((d) => d.title);

    expect(titles).toEqual(['invoice-002', 'Invoice-001']);
  });

  it('never leaks another tenant’s row through search', async () => {
    const page = await service.list(orgId, { search: 'Invoice-999' });

    expect(page.data).toHaveLength(0);
  });

  it('filters by status and by source', async () => {
    const failed = await service.list(orgId, { status: 'failed' });
    expect(failed.data).toHaveLength(1);

    const fromUi = await service.list(orgId, { source: 'ui' });
    expect((fromUi.data as { title: string }[]).map((d) => d.title)).toEqual([
      'Receipt',
      'Invoice-001',
    ]);
  });

  it('filters by date range, with an exclusive upper bound', async () => {
    const page = await service.list(orgId, { from: at(2).toISOString(), to: at(4).toISOString() });

    expect((page.data as { title: string }[]).map((d) => d.title)).toEqual([
      'Statement',
      'invoice-002',
    ]);
  });

  it('rejects a malformed cursor rather than returning the first page again', async () => {
    await expect(service.list(orgId, { cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });
});

describe('DocumentsService.get', () => {
  it('is not reachable with another organization’s id', async () => {
    const mine = await service.list(orgId, { limit: 1 });
    const id = (mine.data[0] as { id: string }).id;

    await expect(service.get(otherOrgId, id)).rejects.toMatchObject({ status: 404 });
    await expect(service.get(orgId, id)).resolves.toMatchObject({ id });
  });
});

describe('DocumentsService.downloadUrl', () => {
  it('names the file after the title', async () => {
    const page = await service.list(orgId, { search: 'invoice-002' });
    const id = (page.data[0] as { id: string }).id;

    const { filename } = await service.downloadUrl(orgId, id);

    expect(filename).toBe('invoice-002.pdf');
  });

  it('refuses a document that never produced a file', async () => {
    const page = await service.list(orgId, { status: 'failed' });
    const id = (page.data[0] as { id: string }).id;

    // 409 with a matching code: the document exists, it just has no file.
    // "not found" would send the caller looking for a different mistake.
    await expect(service.downloadUrl(orgId, id)).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });
});

describe('DocumentsService.remove', () => {
  it('deletes the stored object as well as the row, and records who did it', async () => {
    const document = await prisma.document.create({
      data: { orgId, source: 'ui', status: 'completed', storageKey: 'org/x/doomed.pdf' },
      select: { id: true },
    });

    await service.remove(orgId, document.id, userId);

    expect(deleted).toContain('org/x/doomed.pdf');
    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();

    const audit = await prisma.auditLogEntry.findFirst({
      where: { orgId, action: 'document.delete', target: document.id },
    });
    expect(audit?.actorId).toBe(userId);
  });

  it('will not delete across organizations', async () => {
    const page = await service.list(orgId, { limit: 1 });
    const id = (page.data[0] as { id: string }).id;

    await expect(service.remove(otherOrgId, id)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.document.findUnique({ where: { id } })).not.toBeNull();
  });
});
