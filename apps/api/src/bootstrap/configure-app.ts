import { HttpStatus, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import {
  CSRF_TOKEN_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  REQUEST_ID_HEADER,
  type ApiFieldIssue,
} from '@hyssop/contracts';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ApiError } from '../common/errors/api-error';
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

/**
 * The conditional-request header the browser may send.
 *
 * `docs/06-API-SPEC.md` requires `PATCH /members/:id` to carry the member `revision` in
 * `If-Match` or an equivalent contract, and `apps/web` sends it. A browser sends only the
 * headers named here on a cross-origin request, so an allowlist without `If-Match` would
 * make the preflight for every member edit fail, and the Admin would be unable to save a
 * change at all. It is allowed on any request but is only read by the member route.
 */
export const IF_MATCH_HEADER = 'If-Match';

/**
 * The request headers the browser client may send on a cross-origin request.
 *
 * Every entry is either CORS-safelisted or listed explicitly, because a browser sends only
 * the headers named here on a cross-origin request. A header the client sends that this
 * list omits is rejected by the browser during the preflight, before the request reaches a
 * controller: `fetch` rejects, and `apps/web/src/lib/api-client.ts` reports that rejection
 * as `The API could not be reached.` even though the API is healthy and the identical call
 * succeeds locally. Local development and acceptance runs are same-origin through the Vite
 * proxy, so they issue no preflight at all and cannot observe this class of defect.
 *
 * `IDEMPOTENCY_KEY_HEADER` is listed because `docs/06-API-SPEC.md` requires the key on every
 * create, correction, void, and settings write, and `apps/web` sends it on exactly those
 * requests. Omitting it made recording a member payment, saving an expense, correcting or
 * voiding a transaction, and saving settings all fail on the deployed split-origin site
 * while passing every local test. It is referenced through the shared contract constant
 * rather than re-spelled, so this allowlist cannot drift from the header the browser bundle
 * actually sends.
 */
export const ALLOWED_REQUEST_HEADERS = [
  'Accept',
  'Content-Type',
  REQUEST_ID_HEADER,
  CSRF_TOKEN_HEADER,
  IF_MATCH_HEADER,
  IDEMPOTENCY_KEY_HEADER,
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
      // Without this, a decorator rejection is a plain framework `BadRequestException`. The
      // global filter only reflects field issues from the application's own `ApiError`, so the
      // response would carry a generic message and no `fields` at all — and a browser has
      // nothing to attach the problem to, which contradicts the field-level error
      // requirement in `docs/06-API-SPEC.md`.
      exceptionFactory: validationErrorFactory,
    }),
  );

  app.enableShutdownHooks();
}

/**
 * Converts decorator validation failures into the documented envelope.
 *
 * The message is deliberately generic: the per-field messages are what a form renders, and
 * repeating them in the top-level message would be noise. Constraint metadata is not copied
 * into the response either, because a validator's `constraints` object is a description of
 * the server's internals rather than something a client needs.
 */
function validationErrorFactory(errors: ValidationError[]): ApiError {
  const fields = errors.flatMap(collectFieldIssues);

  return new ApiError(
    'VALIDATION_FAILED',
    'The request could not be validated.',
    HttpStatus.BAD_REQUEST,
    fields.length === 0 ? {} : { fields },
  );
}

/**
 * Flattens one validation error, including nested ones.
 *
 * A DTO can hold a nested object or array, so a dotted path such as `items.0.amount` is what
 * identifies the offending input. Nesting is walked rather than dropped, because reporting
 * only the top-level property would tell the Admin to re-check a field they did not change.
 */
function collectFieldIssues(error: ValidationError): ApiFieldIssue[] {
  const own = (error.constraints ?? {}) as Record<string, string | undefined>;
  const issues: ApiFieldIssue[] = [];

  for (const message of Object.values(own)) {
    if (message !== undefined) {
      issues.push({ field: error.property, message });
    }
  }

  for (const child of error.children ?? []) {
    for (const nested of collectFieldIssues(child)) {
      issues.push({ field: `${error.property}.${nested.field}`, message: nested.message });
    }
  }

  return issues;
}
