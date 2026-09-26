import { EnvironmentValidationError, parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('accepts a minimal development configuration and applies documented defaults', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'development',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    });

    expect(environment).toEqual({
      nodeEnv: 'development',
      port: 3000,
      corsAllowedOrigins: ['http://localhost:5173'],
      logLevel: 'debug',
    });
  });

  it('reads the port, trims origins, and removes duplicates', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      PORT: '4321',
      CORS_ALLOWED_ORIGINS:
        ' http://localhost:5173 , https://hyssop.example ,http://localhost:5173 ',
    });

    expect(environment.port).toBe(4321);
    expect(environment.corsAllowedOrigins).toEqual([
      'http://localhost:5173',
      'https://hyssop.example',
    ]);
    expect(environment.logLevel).toBe('info');
  });

  it('fails when no allowed origin is configured', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'development' })).toThrow(EnvironmentValidationError);
  });

  it('rejects the wildcard origin', () => {
    expect(() => parseEnvironment({ CORS_ALLOWED_ORIGINS: '*' })).toThrow(
      /must not contain the wildcard origin/,
    );
  });

  it('rejects an origin that carries a path', () => {
    expect(() => parseEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173/app' })).toThrow(
      /absolute http or https origins/,
    );
  });

  it.each(['abc', '0', '65536', '3000.5', '-1'])('rejects the invalid port %s', (port) => {
    expect(() => parseEnvironment({ PORT: port, CORS_ALLOWED_ORIGINS: 'http://x.test' })).toThrow(
      /PORT must be an integer between 1 and 65535/,
    );
  });

  it('rejects an unsupported NODE_ENV', () => {
    expect(() =>
      parseEnvironment({ NODE_ENV: 'staging', CORS_ALLOWED_ORIGINS: 'http://x.test' }),
    ).toThrow(/NODE_ENV must be one of/);
  });

  it('reports every problem at once', () => {
    try {
      parseEnvironment({ NODE_ENV: 'staging', PORT: 'abc' });
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
      });
      throw new Error('expected parseEnvironment to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as Error).message).not.toContain(secretLikeValue);
    }
  });
});
