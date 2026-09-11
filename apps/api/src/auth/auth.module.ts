import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersController } from '../users/users.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import type { Env } from '../config/env.schema.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, PasswordService, RefreshTokenService, AuthGuard],
  // JwtModule is exported because the app-level AuthGuard is constructed in
  // AppModule and needs JwtService there.
  exports: [AuthGuard, PasswordService, RefreshTokenService, JwtModule],
})
export class AuthModule {}
