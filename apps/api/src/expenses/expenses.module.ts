import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/**
 * Expense commands, expense reads, and category configuration.
 *
 * Authority: `docs/02-ARCHITECTURE.md` names an `Expenses` module for "expense recording,
 * category management, and expense reads". It imports `TransactionsModule` rather than
 * re-providing the repositories, which is what makes the shared correction, void, audit, and
 * ledger query a single implementation instead of one per transaction type.
 *
 * `DatabaseModule` is imported directly because expenses write their own rows: they allocate
 * the `HY-EXP-` reference and read the category, neither of which goes through
 * `TransactionsModule`.
 */
@Module({
  imports: [TransactionsModule, DatabaseModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
