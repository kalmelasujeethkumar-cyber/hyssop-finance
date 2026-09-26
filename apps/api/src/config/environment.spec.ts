import { EnvironmentValidationError, parseEnvironment } from './environment';

const VALID_DATABASE_URL =
  'postgresql://hyssop_app@127.0.0.1:55432/hyssop_finance_dev?schema=public';
const VALID_DIRECT_DATABASE_URL =
  'postgresql://hyssop_migrator@127.0.0.1:55432/hyssop_finance_dev?schema=public';

describe('parseEnvironment', () => {
  it('accepts a minimal development configuration and applies documented defaults', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'development',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: VALID_DATABASE_URL,
    });

    expect(environment).toEqual({
      nodeEnv: 'development',
      port: 3000,
      corsAllowedOrigins: ['http://localhost:5173'],
      logLevel: 'debug',
      databaseUrl: VALID_DATABASE_URL,
      directDatabaseUrl: null,
    });
  });

  it('reads the port, trims origins, and removes duplicates', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      PORT: '4321',
      CORS_ALLOWED_ORIGINS:
        ' http://localhost:5173 , https://hyssop.example ,http://localhost:5173 ',
      DATABASE_URL: VALID_DATABASE_URL,
      DIRECT_DATABASE_URL: VALID_DIRECT_DATABASE_URL,
    });

    expect(environment.port).toBe(4321);
    expect(environment.corsAllowedOrigins).toEqual([
      'http://localhost:5173',
      'https://hyssop.example',
    ]);
    expect(environment.logLevel).toBe('info');
    expect(environment.directDatabaseUrl).toBe(VALID_DIRECT_DATABASE_URL);
  });

  it('fails when no allowed origin is configured', () => {
    expect(() =>
      parseEnvironment({ NODE_ENV: 'development', DATABASE_URL: VALID_DATABASE_URL }),
    ).toThrow(EnvironmentValidationError);
  });

  it('rejects the wildcard origin', () => {
    expect(() =>
      parseEnvironment({
        CORS_ALLOWED_ORIGINS: '*',
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).toThrow(/must not contain the wildcard origin/);
  });

  it('rejects an origin that carries a path', () => {
    expect(() =>
      parseEnvironment({
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173/app',
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).toThrow(/absolute http or https origins/);
  });

  it.each(['abc', '0', '65536', '3000.5', '-1'])('rejects the invalid port %s', (port) => {
    expect(() =>
      parseEnvironment({
        PORT: port,
        CORS_ALLOWED_ORIGINS: 'http://x.test',
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).toThrow(/PORT must be an integer between 1 and 65535/);
  });

  it('rejects an unsupported NODE_ENV', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'staging',
        CORS_ALLOWED_ORIGINS: 'http://x.test',
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).toThrow(/NODE_ENV must be one of/);
  });

  it('reports every problem at once', () => {
    try {
      parseEnvironment({
        NODE_ENV: 'staging',
        PORT: 'abc',
        DATABASE_URL: VALID_DATABASE_URL,
      });
      throw new Error('expected parseEnvironment to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const problems = (error as EnvironmentValidationError).problems;
      expect(problems).toHaveLength(3);
      expect(problems.join(' ')).toContain('CORS_ALLOWED_ORIGINS');
    }
  });

  it('never echoes a configuration value into the failure message', () => {
    const secretLikeValue = 'sup3r-s3cret-value';

    try {
      parseEnvironment({
        SESSION_SECRET: secretLikeValue,
        CORS_ALLOWED_ORIGINS: `${secretLikeValue}.example`,
        DATABASE_URL: VALID_DATABASE_URL,
      });
      throw new Error('expected parseEnvironment to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as Error).message).not.toContain(secretLikeValue);
    }
  });
});

describe('database configuration (Phase 02)', () => {
  it('requires DATABASE_URL from Phase 02 onward', () => {
    expect(() => parseEnvironment({ CORS_ALLOWED_ORIGINS: 'http://x.test' })).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it('rejects a non-PostgreSQL connection string', () => {
    expect(() =>
      parseEnvironment({
        CORS_ALLOWED_ORIGINS: 'http://x.test',
        DATABASE_URL: 'mysql://localhost/hyssop',
      }),
    ).toThrow(/postgresql:\/\/ connection string/);
  });

  it('refuses a superuser runtime connection, as least privilege requires', () => {
    expect(() =>
      parseEnvironment({
        CORS_ALLOWED_ORIGINS: 'http://x.test',
        DATABASE_URL: 'postgresql://postgres@127.0.0.1:55432/hyssop_finance_dev',
      }),
    ).toThrow(/least-privilege role/);
  });

  it('treats DIRECT_DATABASE_URL as optional for the running API', () => {
    const environment = parseEnvironment({
      CORS_ALLOWED_ORIGINS: 'http://x.test',
      DATABASE_URL: VALID_DATABASE_URL,
      DIRECT_DATABASE_URL: undefined,
    });

    expect(environment.directDatabaseUrl).toBeNull();
  });

  it('never includes the supplied connection value in the error message', () => {
    const secretLikeValue = 'postgresql://hyssop_app:super-secret-value@127.0.0.1:55432/hyssop';

    try {
      parseEnvironment({
        CORS_ALLOWED_ORIGINS: 'http://x.test',
        DATABASE_URL: secretLikeValue,
        DIRECT_DATABASE_URL: 'not-a-connection-string',
      });
      throw new Error('expected parseEnvironment to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });
});
