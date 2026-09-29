import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Version } from '@nestjs/common';
import { success, type TransactionSummary } from '@hyssop/contracts';
import { CurrentRequestId, CurrentSession } from '../auth/auth.decorators';
import type { AuthenticatedSession } from '../auth/session.service';
import { IDEMPOTENCY_KEY_HEADER, readIdempotencyKey } from '../common/http/idempotency';
import type { TransactionActor } from '../transactions/transactions.service';
import { CreateIncomeDto } from './dto/income.dto';
import { IncomeService } from './income.service';

/**
 * The income routes of `docs/06-API-SPEC.md`.
 *
 * That document defines exactly one income route, `POST /api/v1/income`. Listing, detail,
 * correction, void, audit, and receipts are shared transaction routes under `/transactions`
 * and are implemented in `TransactionsController`; duplicating them here is what the
 * architecture's "one canonical representation" rule exists to prevent.
 *
 * The controller only binds HTTP to the service. Income-type rules, exact money parsing,
 * anonymous-donation privacy, and audit actor identity all come from below.
 */
@Controller('income')
export class IncomeController {
  public constructor(private readonly income: IncomeService) {}

  /**
   * Records an income transaction.
   *
   * An `Idempotency-Key` is required. Without one, a double submit or a retry after a timeout
   * would record the same contribution twice and overstate the church's income, which is the
   * single worst failure this feature can have. A missing key is rejected rather than
   * defaulted for exactly that reason.
   */
  @Post()
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  public async createIncome(
    @Body() body: CreateIncomeDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: TransactionSummary }> {
    const actor: TransactionActor = { adminUserId: session.admin.id, requestId };

    return success(
      await this.income.create(body, actor, { key: readIdempotencyKey(idempotencyKey) }),
    );
  }
}
