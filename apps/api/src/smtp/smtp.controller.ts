import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSmtpConfigDto, TestSmtpConfigDto, UpdateSmtpConfigDto } from './dto/smtp.dto.js';
import { SmtpService } from './smtp.service.js';
import type { RequestContext } from '../auth/request-context.js';

/**
 * Dashboard-only, like token management: these are credentials for sending
 * mail as the organization, and an API token has no business editing them.
 * Changes are audited (PLAN §11).
 */
@Controller('smtp')
export class SmtpController {
  constructor(
    private readonly smtp: SmtpService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext) {
    this.requireUser(ctx);
    return this.smtp.list(ctx.orgId);
  }

  @Post()
  async create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateSmtpConfigDto) {
    const userId = this.requireUser(ctx);
    const created = await this.smtp.create(ctx.orgId, dto);

    await this.audit(ctx.orgId, userId, 'smtp.create', created.id);

    return created;
  }

  @Patch(':id')
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSmtpConfigDto,
  ) {
    const userId = this.requireUser(ctx);
    const updated = await this.smtp.update(ctx.orgId, id, dto);

    await this.audit(ctx.orgId, userId, 'smtp.update', id);

    return updated;
  }

  @Post(':id/test')
  @HttpCode(200)
  test(
    @CurrentContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestSmtpConfigDto,
  ) {
    this.requireUser(ctx);
    return this.smtp.test(ctx.orgId, id, dto.to);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const userId = this.requireUser(ctx);
    await this.smtp.remove(ctx.orgId, id);
    await this.audit(ctx.orgId, userId, 'smtp.delete', id);
  }

  private audit(orgId: string, actorId: string, action: string, target: string) {
    return this.prisma.auditLogEntry.create({ data: { orgId, actorId, action, target } });
  }

  private requireUser(ctx: RequestContext): string {
    if (!ctx.userId) {
      throw new ProblemError(
        'forbidden',
        403,
        'SMTP settings are managed from the dashboard, not with an API token',
      );
    }

    return ctx.userId;
  }
}
