import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/**
 * Shared transaction behaviour: correction, void, audit history, and the receipt projection.
 *
 * Authority: `docs/02-ARCHITECTURE.md` names a `Transactions` module for "shared transaction
 * invariants, correction commands, references, and recent activity". It exports its service so
 * the income and expense modules can reuse the exact same correction, void, and audit rules
 * rather than reimplementing them — that shared service is what makes void behave identically
 * for money in and money out.
 *
 * `DatabaseModule` is imported for the same reason `MembersModule` imports it: the repositories are
 * the only place that touches Prisma, and this module must not reach around them. It is not global,
 * so importing it is what makes the injected repositories resolvable here. `IdempotencyCommandRunner`
 * comes from the same import: it is a shared command-replay utility rather than a transaction
 * concern, and every module that accepts a mutation needs it — so it is provided and exported once
 * from `DatabaseModule` next to the `idempotency_record` repository that backs it.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
