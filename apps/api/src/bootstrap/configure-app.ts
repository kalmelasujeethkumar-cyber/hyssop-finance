import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { CSRF_TOKEN_HEADER, REQUEST_ID_HEADER } from '@hyssop/contracts';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { StructuredLogger } from '../common/logging/structured-logger';
import type { AppEnvironment } from '../config/environment';

export const ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

export const ALLOWED_REQUEST_HEADERS = [
  'Accept',
  'Content-Type',
  REQUEST_ID_HEADER,
  CSRF_TOKEN_HEADER,
] as const;

/**
 * Applies the foundation-level HTTP behavior required by `docs/02-ARCHITECTURE.md`,
 * `docs/06-API-SPEC.md`, and `docs/07-SECURITY-RULES.md`: versioned prefix, explicit
 * CORS, baseline security headers, cookie parsing for the session token, and a global
 * validation pipe.
 */
export function configureApp(app: INestApplication, environment: AppEnvironment): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useLogger(app.get(StructuredLogger));

  // Registered without a secret: the session token is an opaque random value looked up by
  // its SHA-256 hash, so there is nothing to sign or decrypt.
  app.use(cookieParser());

  app.use(
    helmet({
      hsts:
        environment.nodeEnv === 'production'
          ? { maxAge: 15552000, includeSubDomains: true }
          : false,
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
    }),
  );

  app.enableCors({
    origin: [...environment.corsAllowedOrigins],
    // Required: the session lives in an HTTP-only cookie, so the browser must be allowed
    // to send it cross-origin to this exact allowlist.
    credentials: true,
    methods: [...ALLOWED_METHODS],
    allowedHeaders: [...ALLOWED_REQUEST_HEADERS],
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();
}
