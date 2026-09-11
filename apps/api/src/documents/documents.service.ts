import { Injectable, Logger } from '@nestjs/common';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { DEFAULT_PAGE_SIZE, type ListDocumentsDto } from './dto/list-documents.dto.js';
import type { Prisma } from '../generated/prisma/client.js';

/** What the list endpoint returns per row — deliberately not the whole record. */
const SUMMARY_SELECT = {
  id: true,
  title: true,
  status: true,
  source: true,
  pageCount: true,
  byteSize: true,
  durationMs: true,
  errorCode: true,
  createdAt: true,
  expiresAt: true,
  creator: { select: { id: true, name: true, email: true } },
} as const;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  optionsJson: true,
  errorMessage: true,
  isEncrypted: true,
  hasWatermark: true,
} as const;

export interface Page<T> {
  data: T[];
  /** Absent on the last page. */
  nextCursor?: string;
}

/**
 * Reads and deletes over the render history.
 *
 * Every method takes `orgId` as its first argument and every query filters on
 * it. A document id is a uuid and unguessable, but that is not an access
 * control decision — one tenant must never be able to reach another's row
 * even holding its id.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(orgId: string, query: ListDocumentsDto): Promise<Page<unknown>> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    // One extra row is the cheapest way to know whether another page exists
    // without a second count query over the same filters.
    const rows = await this.prisma.document.findMany({
      where: this.buildWhere(orgId, query),
      select: SUMMARY_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const data = rows.slice(0, limit);
    const last = data.at(-1);

    return {
      data,
      ...(rows.length > limit && last ? { nextCursor: encodeCursor(last.createdAt, last.id) } : {}),
    };
  }

  async get(orgId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, orgId },
      select: DETAIL_SELECT,
    });

    if (!document) throw new ProblemError('not_found', 404, 'No such document');

    return document;
  }

  /**
   * A short-lived signed URL rather than a proxied stream: the bytes never
   * pass through the api, and the link expires (PLAN §11).
   */
  async downloadUrl(orgId: string, id: string): Promise<{ url: string; filename: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id, orgId },
      select: { id: true, status: true, storageKey: true, title: true },
    });

    if (!document) throw new ProblemError('not_found', 404, 'No such document');

    if (document.status !== 'completed' || !document.storageKey) {
      throw new ProblemError(
        'conflict',
        409,
        `This document is ${document.status}; there is no file to download`,
      );
    }

    const filename = `${sanitiseFilename(document.title) || document.id}.pdf`;

    return { url: await this.storage.signedDownloadUrl(document.storageKey, filename), filename };
  }

  async remove(orgId: string, id: string, actorId?: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id, orgId },
      select: { id: true, storageKey: true },
    });

    if (!document) throw new ProblemError('not_found', 404, 'No such document');

    // The object goes first. If this throws, the row survives and the delete
    // can be retried; the reverse order would orphan the object permanently,
    // with nothing left pointing at it.
    if (document.storageKey) {
      await this.storage.deletePdf(document.storageKey);
    }

    await this.prisma.document.delete({ where: { id: document.id } });

    await this.prisma.auditLogEntry.create({
      data: {
        orgId,
        actorId: actorId ?? null,
        action: 'document.delete',
        target: document.id,
      },
    });

    this.logger.log(`deleted document ${document.id}`);
  }

  private buildWhere(orgId: string, query: ListDocumentsDto): Prisma.DocumentWhereInput {
    const where: Prisma.DocumentWhereInput = { orgId };

    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;

    if (query.search) {
      // ILIKE, backed by the trigram index on documents.title.
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      };
    }

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    if (cursor) {
      // Keyset pagination: "everything ordered after this row". Offsets would
      // skip or repeat rows as new renders land at the top of the list.
      where.AND = [
        {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        },
      ];
    }

    return where;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(timestamp ?? '');

  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new ProblemError('invalid_request', 400, 'Malformed pagination cursor');
  }

  return { createdAt, id };
}

/** Keeps a user-supplied title usable as a download filename. */
function sanitiseFilename(title: string | null): string {
  return (title ?? '')
    .replace(/[^a-zA-Z0-9 ._-]+/g, '')
    .trim()
    .slice(0, 100);
}
