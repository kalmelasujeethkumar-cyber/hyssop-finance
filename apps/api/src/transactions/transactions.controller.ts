import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Version,
} from '@nestjs/common';
import {
  success,
  type ApiListEnvelope,
  type TransactionAuditEventView,
  type TransactionReceiptView,
  type TransactionSummary,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import { IDEMPOTENCY_KEY_HEADER, readIdempotencyKey } from '../common/http/idempotency';
import { CurrentRequestId, CurrentSession } from '../auth/auth.decorators';
import type { AuthenticatedSession } from '../auth/session.service';
import {
  CorrectTransactionDto,
  SharedTransactionFilterQueryDto,
  TransactionIdParamDto,
  TransactionListQueryDto,
  VoidTransactionDto,
} from './dto/transaction.dto';
import { TransactionsService, type TransactionActor } from './transactions.service';

/** `If-Match` carries the transaction `revision` the client read. */
const IF_MATCH_HEADER = 'if-match';

/**
 * The shared transaction routes of `docs/06-API-SPEC.md`.
 *
 * Every route is protected by the global `SessionGuard`; there is no `@Public()` here, so a
 * financial record cannot become reachable without a session by accident.
 *
 * The controller only binds HTTP to the service. Validation, exact money parsing, the
 * type-specific correction rules, audit actor identity, and the idempotency key are all
 * resolved below, and no route builds its own query.
 */
@Controller('transactions')
export class TransactionsController {
  public constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async listTransactions(
    @Query() query: TransactionListQueryDto,
  ): Promise<ApiListEnvelope<TransactionSummary>> {
    return this.transactions.list(listRequestFromQuery(query));
  }

  @Get(':id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async getTransaction(
    @Param() params: TransactionIdParamDto,
  ): Promise<{ data: TransactionSummary }> {
    return success(await this.transactions.detail(params.id));
  }

  /**
   * Audited correction with an optimistic lock.
   *
   * The immutable fields are not in `CorrectTransactionDto`, so the global pipe rejects an
   * attempt to send one with a field-level 400 rather than ignoring it. The revision travels in
   * `If-Match` and a mismatch is a conflict, so two open edit forms cannot overwrite each
   * other's financial change.
   *
   * A repeat of the identical correction is replayed rather than applied twice, so a retried
   * save cannot write a second audit event describing a change that was already recorded.
   */
  @Patch(':id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async correctTransaction(
    @Param() params: TransactionIdParamDto,
    @Body() body: CorrectTransactionDto,
    @Headers(IF_MATCH_HEADER) ifMatch: string | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: TransactionSummary }> {
    return success(
      await this.transactions.correct(
        params.id,
        body,
        readExpectedRevision(ifMatch, 'transaction'),
        actorOf(session, requestId),
        { key: readIdempotencyKey(idempotencyKey) },
      ),
    );
  }

  /**
   * Voids a transaction with a required reason.
   *
   * The row is preserved and stays auditable; it leaves active totals because its status
   * changed, not because anything was deleted (`REQ-FIN-016` to `REQ-FIN-019`).
   */
  @Post(':id/void')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async voidTransaction(
    @Param() params: TransactionIdParamDto,
    @Body() body: VoidTransactionDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: TransactionSummary }> {
    return success(
      await this.transactions.voidTransaction(params.id, body.reason, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }

  /** The transaction's audit trail, oldest first, with previous and new values per change. */
  @Get(':id/audit')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async transactionAudit(
    @Param() params: TransactionIdParamDto,
  ): Promise<{ data: readonly TransactionAuditEventView[] }> {
    return success(await this.transactions.auditTrail(params.id));
  }

  /**
   * The receipt projection for an income transaction.
   *
   * Generated from persisted data on every request, so a corrected amount is reflected
   * immediately. A voided income record still has one, marked `VOIDED`
   * (`REQ-DOC-013`).
   */
  @Get(':id/receipt')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async transactionReceipt(
    @Param() params: TransactionIdParamDto,
  ): Promise<{ data: TransactionReceiptView }> {
    return success(await this.transactions.receipt(params.id));
  }
}

/** The authenticated Admin and the request correlation ID, for audit attribution. */
function actorOf(session: AuthenticatedSession, requestId: string | null): TransactionActor {
  return { adminUserId: session.admin.id, requestId };
}

/**
 * Builds the service request from a validated query DTO.
 *
 * Every key is spread conditionally rather than assigned `undefined`, so "the filter was not
 * supplied" and "the filter was supplied as empty" cannot collapse into one case and silently
 * broaden a query.
 */
export function listRequestFromQuery(query: TransactionListQueryDto) {
  return {
    ...listRequestFromSharedQuery(query),
    ...(query.type === undefined ? {} : { transactionType: query.type }),
    ...(query.incomeType === undefined ? {} : { incomeType: query.incomeType }),
  };
}

/**
 * Builds the service request from the shared filters alone, with no transaction type.
 *
 * This is the expense list's entry point. `ExpenseListQueryDto` extends the shared base
 * without `type` or `incomeType`, so nothing here can set `transactionType`; the expense
 * service then forces `EXPENSE` itself. Together that means the only route able to ask for
 * income is the route that documents it.
 */
export function listRequestFromSharedQuery(query: SharedTransactionFilterQueryDto) {
  return {
    ...(query.search === undefined ? {} : { search: query.search }),
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
    ...(query.sort === undefined ? {} : { sort: query.sort }),
    ...(query.direction === undefined ? {} : { direction: query.direction }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.paymentMethod === undefined ? {} : { paymentMethod: query.paymentMethod }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    ...(query.minAmount === undefined ? {} : { minAmount: query.minAmount }),
    ...(query.maxAmount === undefined ? {} : { maxAmount: query.maxAmount }),
    ...(query.memberId === undefined ? {} : { memberId: query.memberId }),
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.reference === undefined ? {} : { reference: query.reference }),
  };
}

/**
 * Reads the optimistic-lock revision from `If-Match`.
 *
 * The value may be quoted, as the HTTP conditional-request syntax allows, or bare. A missing
 * or non-numeric value is rejected rather than defaulted: treating it as revision 1 would let
 * a client overwrite a financial change it never read, and on a ledger that is a materially
 * worse failure than an extra keystroke for the Admin.
 */
export function readExpectedRevision(ifMatch: string | undefined, entity: string): number {
  if (ifMatch === undefined) {
    throw validationFailed(`An If-Match revision is required to update a ${entity}.`, {
      field: 'If-Match',
    });
  }

  const raw = ifMatch.trim().replace(/^W\//i, '').replace(/^"|"$/g, '').trim();

  if (!/^\d+$/.test(raw)) {
    throw validationFailed(`The If-Match value must be a ${entity} revision number.`, {
      field: 'If-Match',
    });
  }

  const revision = Number.parseInt(raw, 10);

  if (revision < 1) {
    throw validationFailed(`The If-Match value must be a ${entity} revision number.`, {
      field: 'If-Match',
    });
  }

  return revision;
}
