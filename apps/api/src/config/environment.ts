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

/**
 * Connection roles created by `npm run db:start` and `docker-compose.yml`.
 * `DIRECT_DATABASE_URL` is the schema-owner role used only by `prisma migrate`.
 */
export const MIGRATION_ROLE_NAME = 'hyssop_migrator';
export const RUNTIME_ROLE_NAME = 'hyssop_app';

/** PostgreSQL superuser roles that the runtime must never connect as. */
const FORBIDDEN_RUNTIME_ROLES: readonly string[] = ['postgres', 'superuser'];

export interface AppEnvironment {
  readonly nodeEnv: NodeEnvironment;
  readonly port: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly logLevel: LogLevel;
  /** Least-privilege runtime connection string used by the API and by database tests. */
  readonly databaseUrl: string;
  /** Schema-owner connection string used only by migration commands, when configured. */
  readonly directDatabaseUrl: string | null;
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

  if (problems.length > 0) {
    throw new EnvironmentValidationError(problems);
  }

  return { nodeEnv, port, corsAllowedOrigins, logLevel, databaseUrl, directDatabaseUrl };
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
