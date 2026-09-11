import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { ProblemError } from '../common/errors/problem.js';
import { DocumentsService } from '../documents/documents.service.js';
import { RequireScopes } from '../tokens/scopes.js';
import type { RequestContext } from '../auth/request-context.js';

/**
 * PLAN §6: status, and the result URL once complete.
 *
 * The job id is the document id, so this answers from the document row rather
 * than from the queue. That matters after the queue has pruned a completed
 * job: the document outlives it, and "where is my PDF" should not stop being
 * answerable a day later.
 */
@Controller('jobs')
@RequireScopes('documents:read')
export class JobsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':id')
  async status(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const document = await this.documents.get(ctx.orgId, id).catch(() => null);

    if (!document) throw new ProblemError('not_found', 404, 'No such job');

    const base = {
      id: document.id,
      status: document.status,
      title: document.title,
      createdAt: document.createdAt,
    };

    if (document.status === 'completed') {
      const { url, filename } = await this.documents.downloadUrl(ctx.orgId, id);

      return {
        ...base,
        pageCount: document.pageCount,
        byteSize: document.byteSize,
        durationMs: document.durationMs,
        filename,
        url,
      };
    }

    if (document.status === 'failed') {
      return { ...base, errorCode: document.errorCode, errorMessage: document.errorMessage };
    }

    // Queued or rendering. Tell the caller roughly when to look again rather
    // than leaving them to invent a polling interval.
    return { ...base, retryAfterSeconds: 2 };
  }
}
