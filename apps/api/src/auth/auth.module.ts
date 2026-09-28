import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { LoginRateLimiter } from './login-rate-limiter.service';
import { PasswordService } from './password.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { TrustedOriginService } from './trusted-origin.service';

/**
 * Authentication.
 *
 * Owns the four routes of `docs/06-API-SPEC.md` and exports `SessionGuard`, which
 * `AppModule` registers globally so every route is authenticated by default. Data access
 * stays in `DatabaseModule`; this module contains no queries.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    CsrfService,
    LoginRateLimiter,
    PasswordService,
    SessionService,
    SessionGuard,
    TrustedOriginService,
  ],
  // `CsrfService` is exported because `SessionGuard` is instantiated in `AppModule` as a
  // global guard, so Nest resolves its dependencies in that module's context.
  exports: [CsrfService, PasswordService, SessionGuard, SessionService],
})
export class AuthModule {}
