import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import { StructuredLogger } from '../../common/logging/structured-logger';
import { getAppEnvironment } from '../../config/environment';

/**
 * Lifecycle wrapper around the generated Prisma client.
 *
 * Authority: `docs/02-ARCHITECTURE.md` (one shared client, repository layer for all
 * data access) and `docs/05-DATABASE-SPEC.md` (the runtime connects with the
 * least-privilege `hyssop_app` role, never with `DIRECT_DATABASE_URL`).
 *
 * The connection string comes from the validated application configuration rather than
 * a separate environment read, so the value the client uses is the value that passed
 * startup validation. The connection is established lazily by Prisma on first use
 * instead of at module initialization, so importing the application module does not
 * require a running database. `verifyConnectivity` exists for the database test
 * harness and for a future readiness check; `docs/06-API-SPEC.md` currently defines the
 * health endpoint as a process check only, and this phase does not add one.
 *
 * Interactive transaction waits are raised above Prisma's 2 s / 5 s defaults. Reference
 * allocation is intentionally serialized per scope by the `id_sequence` row lock, so a
 * burst of concurrent writers queues behind one another by design. With the defaults the
 * last writer in a documented burst fails with `Unable to start a transaction in the given
 * time` instead of waiting its turn, which would surface as a spurious server error. The
 * values below keep the wait bounded instead of unbounded.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  public constructor(
    config: ConfigService,
    private readonly logger: StructuredLogger,
  ) {
    super({
      datasourceUrl: getAppEnvironment(config).databaseUrl,
      transactionOptions: { maxWait: 15_000, timeout: 30_000 },
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Confirms the configured role can actually reach the database. */
  public async verifyConnectivity(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /** Routes Prisma client warnings and errors through the redacting structured logger. */
  public attachClientLogging(): void {
    this.registerClientLogHandler('warn', 'warn');
    this.registerClientLogHandler('error', 'error');
  }

  /**
   * The generated `$on` signature infers its event union from the constructor option,
   * which a subclass cannot express, so the event type is named explicitly here.
   */
  private registerClientLogHandler(level: 'warn' | 'error', logLevel: 'warn' | 'error'): void {
    this.$on(level as never, (event: Prisma.LogEvent) => {
      this.logger.logRequest(logLevel, 'database client message', { reason: event.message });
    });
  }
}
