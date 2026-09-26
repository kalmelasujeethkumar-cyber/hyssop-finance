import { StructuredLogger, type LogSink } from './structured-logger';

function createLogger(minLevel: 'debug' | 'info' | 'warn' | 'error') {
  const lines: string[] = [];
  const sink: LogSink = (line) => lines.push(line);
  const logger = new StructuredLogger(minLevel, sink, () => new Date('2026-09-26T09:15:00.000Z'));
  return { logger, lines };
}

describe('StructuredLogger', () => {
  it('writes one JSON line with time, level, and message', () => {
    const { logger, lines } = createLogger('info');

    logger.log('api started');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      time: '2026-09-26T09:15:00.000Z',
      level: 'info',
      message: 'api started',
    });
  });

  it('records the Nest context string when one is supplied', () => {
    const { logger, lines } = createLogger('info');

    logger.warn('unexpected state', 'HealthService');

    expect(JSON.parse(lines[0] as string)).toMatchObject({
      level: 'warn',
      message: 'unexpected state',
      context: 'HealthService',
    });
  });

  it('suppresses entries below the configured level', () => {
    const { logger, lines } = createLogger('warn');

    logger.debug('noisy');
    logger.log('also noisy');
    logger.warn('kept');
    logger.error('kept too');

    expect(lines.map((line) => (JSON.parse(line) as { level: string }).level)).toEqual([
      'warn',
      'error',
    ]);
  });

  it('redacts sensitive fields and includes the request ID', () => {
    const { logger, lines } = createLogger('info');

    logger.logRequest(
      'info',
      'request completed',
      { method: 'GET', path: '/api/v1/health', authorization: 'Bearer secret-token' },
      '3f0a1b2c-4d5e-4f60-8a71-9b2c3d4e5f60',
    );

    expect(JSON.parse(lines[0] as string)).toEqual({
      time: '2026-09-26T09:15:00.000Z',
      level: 'info',
      message: 'request completed',
      method: 'GET',
      path: '/api/v1/health',
      authorization: '[REDACTED]',
      requestId: '3f0a1b2c-4d5e-4f60-8a71-9b2c3d4e5f60',
    });
  });

  it('serializes an Error message with its stack for server-side diagnosis', () => {
    const { logger, lines } = createLogger('error');

    logger.error(new Error('boom'));

    const entry = JSON.parse(lines[0] as string) as { level: string; message: { name: string } };
    expect(entry.level).toBe('error');
    expect(entry.message.name).toBe('Error');
  });

  it('survives a circular field value', () => {
    const { logger, lines } = createLogger('info');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    logger.logRequest('info', 'request completed', circular, 'request-1');

    expect(JSON.parse(lines[0] as string)).toMatchObject({ self: { self: '[CIRCULAR]' } });
  });
});
