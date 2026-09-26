import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAppEnvironment, resolveLogLevel } from '../../config/environment';
import { StructuredLogger } from './structured-logger';

/**
 * Global redacting logger.
 *
 * Authority: `docs/07-SECURITY-RULES.md` requires that secrets, tokens, and
 * credentials never reach a log line. The logger is global so infrastructure such as
 * the Prisma client can report database warnings through the same redacting path
 * instead of writing raw driver output to the console.
 */
@Global()
@Module({
  providers: [
    {
      provide: StructuredLogger,
      useFactory: (config: ConfigService) =>
        new StructuredLogger(resolveLogLevel(getAppEnvironment(config).nodeEnv)),
      inject: [ConfigService],
    },
  ],
  exports: [StructuredLogger],
})
export class LoggingModule {}
