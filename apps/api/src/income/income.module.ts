import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';

/**
 * Income commands and reads.
 *
 * Authority: `docs/02-ARCHITECTURE.md` names an `Income` module for "contribution, offering,
 * donation, and anonymous donation commands and reads". It imports `TransactionsModule` rather
 * than re-providing the repositories, which is what makes the shared correction, void, audit,
 * and receipt behaviour a single implementation instead of one per income type.
 *
 * `DatabaseModule` is imported directly because income writes its own rows: it opens the
 * member-month, allocates the `HY-INC-` reference, and reads the configured default
 * contribution, none of which go through `TransactionsModule`.
 */
@Module({
  imports: [TransactionsModule, DatabaseModule],
  controllers: [IncomeController],
  providers: [IncomeService],
  exports: [IncomeService],
})
export class IncomeModule {}
