import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { ProblemError } from '../common/errors/problem.js';
import { CreateTokenDto } from './dto/token.dto.js';
import { SCOPES } from './scopes.js';
import { TokensService } from './tokens.service.js';
import type { RequestContext } from '../auth/request-context.js';

/**
 * Minting and revoking are dashboard-only.
 *
 * A token that can mint tokens is a token that can silently outlive its own
 * revocation, so this whole controller requires a user session (PLAN §5 puts
 * token management in the dashboard, and §11 audits it).
 */
@Controller('tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get('scopes')
  availableScopes() {
    return { scopes: SCOPES };
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext) {
    this.requireUser(ctx);
    return this.tokens.list(ctx.orgId);
  }

  @Post()
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateTokenDto) {
    const userId = this.requireUser(ctx);
    return this.tokens.create(ctx.orgId, dto, userId);
  }

  @Delete(':id')
  @HttpCode(200)
  revoke(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const userId = this.requireUser(ctx);
    return this.tokens.revoke(ctx.orgId, id, userId);
  }

  private requireUser(ctx: RequestContext): string {
    if (!ctx.userId) {
      // 403, not 401: the code is the contract, and it must agree with the
      // status. The credential is valid; it just has no business here.
      throw new ProblemError(
        'forbidden',
        403,
        'API tokens are managed from the dashboard, not with an API token',
      );
    }

    return ctx.userId;
  }
}
