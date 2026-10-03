import type { ConfigService } from '@nestjs/config';

/**
 * Fail-fast configuration parsing.
 *
 * Owned by `docs/02-ARCHITECTURE.md` and `docs/07-SECURITY-RULES.md`. Only
 * configuration required by the running phase is validated; later-phase values
 * (database, session, storage) are deliberately ignored until they exist.
 */

export const SUPPORTED_NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof SUPPORTED_NODE_ENVIRONMENTS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_PORT = 3000;

export const COOKIE_SAME_SITE_VALUES = ['lax', 'strict', 'none'] as const;

export type CookieSameSite = (typeof COOKIE_SAME_SITE_VALUES)[number];

/**
 * Argon2id cost. The defaults are the OWASP minimum for Argon2id and are
 * intentionally not raised further, so the demo stays responsive on modest hardware.
 * Documented in `.env.example` and in `docs/runtime/DECISIONS.md`.
 */
export const DEFAULT_ARGON2_MEMORY_KIB = 19456;
export const DEFAULT_ARGON2_ITERATIONS = 2;
export const DEFAULT_ARGON2_PARALLELISM = 1;

export const DEFAULT_SESSION_TTL_HOURS = 8;
export const DEFAULT_CSRF_TTL_MINUTES = 15;
export const DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MINUTES = 15;

/**
 * General request-abuse ceilings.
 *
 * Authority: `docs/07-SECURITY-RULES.md` requires "safe login, upload, search, export, and
 * mutation limits", and the login control above covers only sign-in. These four ceilings cover
 * the remaining categories the document names. They are validated, named values rather than
 * constants in the guard so an operator can tighten them without a code change, and the defaults
 * are deliberately generous: the demo has one Admin, so a limit that a single deliberate session
 * can reach would refuse honest work rather than abuse. `RATE_LIMIT_WINDOW_MINUTES` is shared by
 * all four categories.
 */
export const DEFAULT_RATE_LIMIT_WINDOW_MINUTES = 1;
export const DEFAULT_MUTATION_RATE_LIMIT_MAX_REQUESTS = 300;
export const DEFAULT_SEARCH_RATE_LIMIT_MAX_REQUESTS = 300;
export const DEFAULT_UPLOAD_RATE_LIMIT_MAX_REQUESTS = 120;
export const DEFAULT_EXPORT_RATE_LIMIT_MAX_REQUESTS = 120;

/** Maximum session lifetime, so a mistyped value cannot create a permanent session. */
export const MAX_SESSION_TTL_HOURS = 720;
/**
 * The only storage driver Phase 07 ships.
 *
 * A closed set rather than a free string: `docs/02-ARCHITECTURE.md` requires the storage
 * boundary to be replaceable, and a replaceable boundary is only meaningful if an unknown driver
 * name fails loudly at startup instead of silently falling back to local storage in an
 * environment that believes it is talking to object storage.
 */
export const STORAGE_DRIVERS = ['local'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];
/** Matches the commented placeholder in `.env.example`. */
export const DEFAULT_LOCAL_STORAGE_PATH = './storage/uploads';
/** Matches the commented placeholder in `.env.example`. */
export const DEFAULT_UPLOAD_MAX_BYTES = 10_485_760;
/**
 * The upload ceiling is bounded rather than free.
 *
 * The upper bound is a deliberate defence: `docs/07-SECURITY-RULES.md` requires a documented
 * upload limit and a request that cannot exhaust the demo server. An administrator who raises the
 * limit past this value is almost certainly misreading kilobytes for bytes, and a limit above it
 * would put a buffer that size on a machine that may have none.
 */
export const MIN_UPLOAD_MAX_BYTES = 1024;
export const MAX_UPLOAD_MAX_BYTES = 104_857_600;

/**
 * Connection roles created by `npm run db:start` and `docker-compose.yml`.
 * `DIRECT_DATABASE_URL` is the schema-owner role used only by `prisma migrate`.
 */
export const MIGRATION_ROLE_NAME = 'hyssop_migrator';
export const RUNTIME_ROLE_NAME = 'hyssop_app';

/** PostgreSQL superuser roles that the runtime must never connect as. */
const FORBIDDEN_RUNTIME_ROLES: readonly string[] = ['postgres', 'superuser'];

export interface Argon2Parameters {
  readonly memoryKib: number;
  readonly iterations: number;
  readonly parallelism: number;
}

/**
 * Authentication configuration. `docs/07-SECURITY-RULES.md` requires secure,
 * explicitly verified cookie policy, revocable sessions, and rate-limited login, so
 * each of those is a validated, named value rather than a constant in a service.
 */
export interface AuthEnvironment {
  readonly sessionCookieName: string;
  readonly csrfCookieName: string;
  /** `SameSite=None` is only valid with `Secure`, per the cookie rules in the browser. */
  readonly cookieSameSite: CookieSameSite;
  readonly cookieSecure: boolean;
  readonly sessionTtlHours: number;
  readonly csrfTtlMinutes: number;
  readonly argon2: Argon2Parameters;
  readonly loginRateLimitMaxAttempts: number;
  readonly loginRateLimitWindowMinutes: number;
}

/** One request-abuse ceiling: at most `maxRequests` per `windowMinutes`, per client. */
export interface RateLimitRule {
  readonly maxRequests: number;
  readonly windowMinutes: number;
}

/**
 * The non-login abuse ceilings of `docs/07-SECURITY-RULES.md`. Login keeps its own dedicated,
 * pre-credential limiter (see `DEC-066`); these cover uploads, searches, exports, and every
 * state-changing method.
 */
export interface RateLimitEnvironment {
  readonly mutation: RateLimitRule;
  readonly search: RateLimitRule;
  readonly upload: RateLimitRule;
  readonly export: RateLimitRule;
}

export interface AppEnvironment {
  readonly nodeEnv: NodeEnvironment;
  readonly port: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly logLevel: LogLevel;
  /** Least-privilege runtime connection string used by the API and by database tests. */
  readonly databaseUrl: string;
  /** Schema-owner connection string used only by migration commands, when configured. */
  readonly directDatabaseUrl: string | null;
  readonly auth: AuthEnvironment;
  /** Phase 12 general request-abuse ceilings. */
  readonly rateLimit: RateLimitEnvironment;
  /** Phase 07 document storage. `docs/02-ARCHITECTURE.md` "Storage boundary". */
  readonly storage: StorageEnvironment;
}

/**
 * Document storage configuration.
 *
 * `docs/02-ARCHITECTURE.md` requires "the storage path configuration explicit and replaceable for
 * production", and `docs/12-DEPLOYMENT-PLAN.md` records that a local disk is not durable or
 * shared across replicas. Naming the driver and the path as validated values is what makes that
 * substitution a configuration change rather than a code change.
 */
export interface StorageEnvironment {
  readonly driver: StorageDriver;
  /** As configured, so it can be reported honestly without resolving it into an absolute path. */
  readonly localStoragePath: string;
  /** Per-file byte ceiling enforced by the multipart parser before anything is buffered. */
  readonly uploadMaxBytes: number;
}

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Raised when configuration is missing or malformed. Messages name the variable
 * and the rule but never echo the supplied value, so a misconfigured secret can
 * never reach a log line or a terminal.
 */
export class EnvironmentValidationError extends Error {
  public constructor(public readonly problems: readonly string[]) {
    super(`Invalid environment configuration: ${problems.join('; ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

export function parseEnvironment(source: EnvironmentSource): AppEnvironment {
  const problems: string[] = [];

  const nodeEnv = parseNodeEnvironment(source['NODE_ENV'], problems);
  const port = parsePort(source['PORT'], problems);
  const corsAllowedOrigins = parseCorsAllowedOrigins(source['CORS_ALLOWED_ORIGINS'], problems);
  const logLevel = nodeEnv === 'development' ? 'debug' : 'info';
  const databaseUrl = parseDatabaseUrl(source['DATABASE_URL'], problems);
  const directDatabaseUrl = parseDirectDatabaseUrl(source['DIRECT_DATABASE_URL'], problems);
  const auth = parseAuthEnvironment(source, problems);
  const rateLimit = parseRateLimitEnvironment(source, problems);
  const storage = parseStorageEnvironment(source, problems);

  if (problems.length > 0) {
    throw new EnvironmentValidationError(problems);
  }

  return {
    nodeEnv,
    port,
    corsAllowedOrigins,
    logLevel,
    databaseUrl,
    directDatabaseUrl,
    auth,
    rateLimit,
    storage,
  };
}

export function resolveLogLevel(nodeEnv: NodeEnvironment): LogLevel {
  return nodeEnv === 'development' ? 'debug' : 'info';
}

export function getAppEnvironment(config: ConfigService): AppEnvironment {
  return config.getOrThrow<AppEnvironment>('environment');
}

function parseNodeEnvironment(raw: string | undefined, problems: string[]): NodeEnvironment {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    return 'development';
  }

  const match = SUPPORTED_NODE_ENVIRONMENTS.find((candidate) => candidate === value);
  if (match === undefined) {
    problems.push('NODE_ENV must be one of: development, test, production');
    return 'development';
  }

  return match;
}

function parsePort(raw: string | undefined, problems: string[]): number {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    return DEFAULT_PORT;
  }

  if (!/^\d{1,5}$/.test(value)) {
    problems.push('PORT must be an integer between 1 and 65535');
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(value, 10);
  if (port < 1 || port > 65535) {
    problems.push('PORT must be an integer between 1 and 65535');
    return DEFAULT_PORT;
  }

  return port;
}

function parseCorsAllowedOrigins(raw: string | undefined, problems: string[]): readonly string[] {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    problems.push('CORS_ALLOWED_ORIGINS is required and must list at least one exact origin');
    return [];
  }

  const origins = [
    ...new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];

  if (origins.length === 0) {
    problems.push('CORS_ALLOWED_ORIGINS is required and must list at least one exact origin');
    return [];
  }

  for (const origin of origins) {
    if (origin === '*') {
      problems.push('CORS_ALLOWED_ORIGINS must not contain the wildcard origin');
      continue;
    }

    if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(origin)) {
      problems.push('CORS_ALLOWED_ORIGINS must contain only absolute http or https origins');
    }
  }

  return origins;
}

/**
 * The runtime connection is required from Phase 02 and must not be a superuser
 * connection, as required by `docs/05-DATABASE-SPEC.md` and `docs/07-SECURITY-RULES.md`.
 * The message names the rule but never the value, so a password cannot be logged.
 */
function parseDatabaseUrl(raw: string | undefined, problems: string[]): string {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    problems.push('DATABASE_URL is required and must be a PostgreSQL connection string');
    return '';
  }

  assertPostgresUrl(value, 'DATABASE_URL', problems);
  assertNotSuperuserRole(value, 'DATABASE_URL', problems);

  return value;
}

function parseDirectDatabaseUrl(raw: string | undefined, problems: string[]): string | null {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    return null;
  }

  assertPostgresUrl(value, 'DIRECT_DATABASE_URL', problems);
  return value;
}

/**
 * Authentication configuration parsing.
 *
 * Every value here is a cookie, lifetime, or cost that `docs/07-SECURITY-RULES.md`
 * requires to be explicitly verified rather than assumed. A failure names the variable
 * and the rule and never echoes the value, so a misconfigured secret cannot be logged.
 */
export function parseAuthEnvironment(
  source: EnvironmentSource,
  problems: string[],
): AuthEnvironment {
  const sessionCookieName = parseCookieName(
    source['SESSION_COOKIE_NAME'],
    'SESSION_COOKIE_NAME',
    'hyssop_session',
    problems,
  );
  const csrfCookieName = parseCookieName(
    source['CSRF_COOKIE_NAME'],
    'CSRF_COOKIE_NAME',
    'hyssop_csrf',
    problems,
  );

  if (sessionCookieName === csrfCookieName) {
    problems.push('CSRF_COOKIE_NAME must differ from SESSION_COOKIE_NAME');
  }

  const cookieSameSite = parseCookieSameSite(source['SESSION_COOKIE_SAME_SITE'], problems);
  const cookieSecure = parseBoolean(source['COOKIE_SECURE'], 'COOKIE_SECURE', false, problems);
  const sessionTtlHours = parseBoundedNumber(
    source['SESSION_TTL_HOURS'],
    'SESSION_TTL_HOURS',
    DEFAULT_SESSION_TTL_HOURS,
    1,
    MAX_SESSION_TTL_HOURS,
    problems,
  );
  const csrfTtlMinutes = parseBoundedNumber(
    source['CSRF_TTL_MINUTES'],
    'CSRF_TTL_MINUTES',
    DEFAULT_CSRF_TTL_MINUTES,
    1,
    120,
    problems,
  );
  const argon2 = {
    memoryKib: parseBoundedNumber(
      source['ARGON2_MEMORY_KIB'],
      'ARGON2_MEMORY_KIB',
      DEFAULT_ARGON2_MEMORY_KIB,
      8192,
      262144,
      problems,
    ),
    iterations: parseBoundedNumber(
      source['ARGON2_ITERATIONS'],
      'ARGON2_ITERATIONS',
      DEFAULT_ARGON2_ITERATIONS,
      1,
      16,
      problems,
    ),
    parallelism: parseBoundedNumber(
      source['ARGON2_PARALLELISM'],
      'ARGON2_PARALLELISM',
      DEFAULT_ARGON2_PARALLELISM,
      1,
      16,
      problems,
    ),
  };
  const loginRateLimitMaxAttempts = parseBoundedNumber(
    source['LOGIN_RATE_LIMIT_MAX_ATTEMPTS'],
    'LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
    DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    1,
    100,
    problems,
  );
  const loginRateLimitWindowMinutes = parseBoundedNumber(
    source['LOGIN_RATE_LIMIT_WINDOW_MINUTES'],
    'LOGIN_RATE_LIMIT_WINDOW_MINUTES',
    DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MINUTES,
    1,
    1440,
    problems,
  );

  // A `SameSite=None` cookie is discarded by browsers unless it is also `Secure`, so
  // accepting the combination silently would produce a confusing cross-site login loop.
  if (cookieSameSite === 'none' && !cookieSecure) {
    problems.push('SESSION_COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
  }

  return {
    sessionCookieName,
    csrfCookieName,
    cookieSameSite,
    cookieSecure,
    sessionTtlHours,
    csrfTtlMinutes,
    argon2,
    loginRateLimitMaxAttempts,
    loginRateLimitWindowMinutes,
  };
}

/**
 * Parses the general request-abuse ceilings.
 *
 * Every value is bounded on both sides. A zero ceiling would refuse the very action the limit is
 * meant to protect rather than abuse it, and an enormous one would be no limit at all; both are
 * caught at startup so a mistyped `.env` fails loudly instead of silently changing the posture.
 */
export function parseRateLimitEnvironment(
  source: EnvironmentSource,
  problems: string[],
): RateLimitEnvironment {
  const windowMinutes = parseBoundedNumber(
    source['RATE_LIMIT_WINDOW_MINUTES'],
    'RATE_LIMIT_WINDOW_MINUTES',
    DEFAULT_RATE_LIMIT_WINDOW_MINUTES,
    1,
    1440,
    problems,
  );

  const rule = (variable: string, fallback: number): RateLimitRule => ({
    maxRequests: parseBoundedNumber(source[variable], variable, fallback, 1, 100_000, problems),
    windowMinutes,
  });

  return {
    mutation: rule('MUTATION_RATE_LIMIT_MAX_REQUESTS', DEFAULT_MUTATION_RATE_LIMIT_MAX_REQUESTS),
    search: rule('SEARCH_RATE_LIMIT_MAX_REQUESTS', DEFAULT_SEARCH_RATE_LIMIT_MAX_REQUESTS),
    upload: rule('UPLOAD_RATE_LIMIT_MAX_REQUESTS', DEFAULT_UPLOAD_RATE_LIMIT_MAX_REQUESTS),
    export: rule('EXPORT_RATE_LIMIT_MAX_REQUESTS', DEFAULT_EXPORT_RATE_LIMIT_MAX_REQUESTS),
  };
}

/**
 * Parses the Phase 07 document-storage settings.
 *
 * Each rule is enforced rather than defaulted silently:
 *
 * - An unknown `STORAGE_DRIVER` is a startup failure. Accepting it and continuing on local disk
 *   would let a deployment believe it is writing to durable object storage while writing to an
 *   ephemeral container filesystem, which is precisely the failure `docs/12-DEPLOYMENT-PLAN.md`
 *   warns must not be hidden.
 * - A `LOCAL_STORAGE_PATH` containing a `..` segment is rejected. The demo path is project-local
 *   by contract, so a traversal out of the repository is a configuration mistake, not an intent.
 * - `UPLOAD_MAX_BYTES` is bounded on both sides, so a zero-byte limit that would reject every
 *   upload and a gigabyte limit that would exhaust memory are both caught at startup rather than
 *   discovered by the Admin mid-upload.
 */
function parseStorageEnvironment(
  source: EnvironmentSource,
  problems: string[],
): StorageEnvironment {
  const driverValue = source['STORAGE_DRIVER']?.trim().toLowerCase();

  // `STORAGE_DRIVER` is optional, so "absent" and "explicitly local" both mean the local adapter.
  // The remaining case is a value outside the closed set, which is a configuration error rather
  // than a request to guess: continuing on local disk would let a deployment believe it writes to
  // durable object storage while writing to a container filesystem that disappears on redeploy.
  const driver: StorageDriver =
    driverValue === undefined || driverValue === '' ? 'local' : (driverValue as StorageDriver);

  if (!STORAGE_DRIVERS.includes(driver)) {
    problems.push(`STORAGE_DRIVER must be one of: ${STORAGE_DRIVERS.join(', ')}`);
  }

  const rawPath = source['LOCAL_STORAGE_PATH']?.trim();
  const localStoragePath =
    rawPath === undefined || rawPath === '' ? DEFAULT_LOCAL_STORAGE_PATH : rawPath;

  if (localStoragePath.split(/[\\/]/).includes('..')) {
    problems.push('LOCAL_STORAGE_PATH must stay inside the project and must not contain ".."');
  }

  return {
    driver: STORAGE_DRIVERS.includes(driver) ? driver : 'local',
    localStoragePath,
    uploadMaxBytes: parseBoundedNumber(
      source['UPLOAD_MAX_BYTES'],
      'UPLOAD_MAX_BYTES',
      DEFAULT_UPLOAD_MAX_BYTES,
      MIN_UPLOAD_MAX_BYTES,
      MAX_UPLOAD_MAX_BYTES,
      problems,
    ),
  };
}

function parseCookieName(
  raw: string | undefined,
  name: string,
  fallback: string,
  problems: string[],
): string {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    return fallback;
  }

  // RFC 6265 cookie names are tokens; anything else would be silently dropped or split.
  if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]{1,64}$/.test(value)) {
    problems.push(`${name} must be a valid cookie name of at most 64 token characters`);
    return fallback;
  }

  return value;
}

function parseCookieSameSite(raw: string | undefined, problems: string[]): CookieSameSite {
  const value = raw?.trim().toLowerCase();

  if (value === undefined || value === '') {
    return 'lax';
  }

  const match = COOKIE_SAME_SITE_VALUES.find((candidate) => candidate === value);

  if (match === undefined) {
    problems.push('SESSION_COOKIE_SAME_SITE must be one of: lax, strict, none');
    return 'lax';
  }

  return match;
}

function parseBoolean(
  raw: string | undefined,
  name: string,
  fallback: boolean,
  problems: string[],
): boolean {
  const value = raw?.trim().toLowerCase();

  if (value === undefined || value === '') {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  problems.push(`${name} must be exactly true or false`);
  return fallback;
}

function parseBoundedNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  problems: string[],
): number {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    return fallback;
  }

  if (!/^\d{1,6}$/.test(value)) {
    problems.push(`${name} must be a whole number between ${minimum} and ${maximum}`);
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (parsed < minimum || parsed > maximum) {
    problems.push(`${name} must be a whole number between ${minimum} and ${maximum}`);
    return fallback;
  }

  return parsed;
}

function assertPostgresUrl(value: string, name: string, problems: string[]): void {
  if (!/^postgres(?:ql)?:\/\/[^\s]+$/.test(value)) {
    problems.push(`${name} must be a postgresql:// connection string`);
  }
}

function assertNotSuperuserRole(value: string, name: string, problems: string[]): void {
  const role = roleFromConnectionString(value);

  if (role !== null && FORBIDDEN_RUNTIME_ROLES.includes(role.toLowerCase())) {
    problems.push(`${name} must use a least-privilege role, not a PostgreSQL superuser`);
  }
}

function roleFromConnectionString(value: string): string | null {
  const authority = /^postgres(?:ql)?:\/\/([^/?#]*)/.exec(value)?.[1];

  if (authority === undefined || authority === '') {
    return null;
  }

  const credentials = authority.split('@')[0] ?? '';
  const userInfo = credentials.split(':')[0] ?? '';

  return userInfo === '' ? null : decodeURIComponent(userInfo);
}
