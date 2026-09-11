import { Global, Module } from '@nestjs/common';
import { TokensController } from './tokens.controller.js';
import { TokensService } from './tokens.service.js';

// Global because the app-level AuthGuard, constructed in AppModule, resolves
// TokensService to verify API credentials.
@Global()
@Module({
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
