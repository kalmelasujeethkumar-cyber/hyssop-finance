import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { REQUEST_ID_HEADER } from '@hyssop/contracts';
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

export const ALLOWED_REQUEST_HEADERS = ['Accept', 'Content-Type', REQUEST_ID_HEADER] as const;

/**
 * Applies the foundation-level HTTP behavior required by `docs/02-ARCHITECTURE.md`,
 * `docs/06-API-SPEC.md`, and `docs/07-SECURITY-RULES.md`: versioned prefix, explicit
 * CORS, baseline security headers, and a global validation pipe.
 */
export function configureApp(app: INestApplication, environment: AppEnvironment): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useLogger(app.get(StructuredLogger));

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
    credentials: true,
    methods: [...ALLOWED_METHODS],
    allowedHeaders: [...ALLOWED_REQUEST_HEADERS],
    exposedHeaders: [REQUEST_ID_HEADER],
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
