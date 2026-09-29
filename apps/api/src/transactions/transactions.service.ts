import { Injectable } from '@nestjs/common';
import {
  list as listEnvelope,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  TRANSACTION_PAGE_SIZE_MAX,
  isAnonymousIncomeType,
  type ApiListEnvelope,
  type IncomeType,
  type PaymentMethod,
  type TransactionAuditEventView,
  type TransactionReceiptView,
  type TransactionStatus,
  type TransactionSummary,
  type TransactionType,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import { IdempotentCommandRunner, type IdempotencyKey } from '../common/http/idempotency';
import { formatPaise, parsePaise } from '../common/money/paise';
import { parseBusinessDate } from '../common/time/business-date';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../database/audit/audit-event.repository';
import { ExpenseCategoryRepository } from '../database/categories/expense-category.repository';
import { MemberRepository } from '../database/members/member.repository';
import {
  TransactionRepository,
  type TransactionQueryFilters,
  type TransactionSortDirection,
  type TransactionSortField,
  type TransactionWithRelations,
} from '../database/transactions/transaction.repository';
import type { CorrectTransactionDto } from './dto/transaction.dto';
import { toAuditEventViews, toReceiptView, toTransactionSummary } from './transaction-mapper';

/**
 * The endpoint identities idempotency keys are scoped to.
 *
 * The method, the versioned path, and the concrete transaction id are all part of the
 * identity, so a key used against a different transaction is a different command rather than
 * a replay of this one. Without the id, voiding transaction A and then voiding transaction
 * B with the same key would return A's stored response for B.
 */
const CORRECT_ENDPOINT = 'PATCH /api/v1/transactions';
const VOID_ENDPOINT = 'POST /api/v1/transactions/void';

/** The shared list request, optionally narrowed to one side of the ledger. */
export interface TransactionListRequest {
  readonly transactionType?: TransactionType;
  /** `docs/06-API-SPEC.md` requires the transaction list to filter by income type. */
  readonly incomeType?: IncomeType;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sort?: TransactionSortField;
  readonly direction?: TransactionSortDirection;
  readonly status?: TransactionStatus;
  readonly paymentMethod?: PaymentMethod;
  readonly from?: string;
  readonly to?: string;
  readonly minAmount?: string;
  readonly maxAmount?: string;
  readonly memberId?: string;
  readonly categoryId?: string;
  readonly reference?: string;
}

/** Everything a financial mutation needs to attribute itself in the audit trail. */
export interface TransactionActor {
  readonly adminUserId: string;
  readonly requestId: string | null;
}

/**
 * Shared transaction behaviour for income and expenses.
 *
 * Authority: `docs/02-ARCHITECTURE.md` requires one canonical representation across both
 * modules, and `docs/01-REQUIREMENTS.md` `REQ-FIN-015` to `REQ-FIN-020` owns correction,
 * void, and audit. This service is that shared rule set: income and expenses each own their
 * own *create* rules, and everything about correcting, voiding, reading history, and
 * projecting a receipt happens exactly once, here.
 *
 * The rules this layer refuses to delegate:
 *
 * 1. **Money is exact.** Amounts cross the boundary as decimal strings and become `bigint`
 *    paise through the strict parser. There is no floating-point arithmetic anywhere, and an
 *    ambiguous value is rejected rather than rounded (`REQ-FIN-021`).
 * 2. **A correction can only touch the allow-list, and only in a way the type permits.**
 *    Identity, reference, transaction type, creator, creation time, status, and void fields
 *    are not in the DTO, so the global pipe already rejects them. What remains is the
 *    *type-specific* judgement: a member contribution cannot be moved to another member, an
 *    anonymous donation cannot acquire a member or free text, and an expense cannot acquire
 *    an income association.
 * 3. **Void preserves, never deletes.** The row survives with its amount, its history, and a
 *    reason; it leaves active totals because its status changed, not because it was removed.
 * 4. **Anonymous identity is stripped on the way out as well as on the way in.** See
 *    `transaction-mapper.ts`; the create path rejects identity-bearing input and the read
 *    path independently refuses to project it.
 */
@Injectable()
export class TransactionsService {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditEventRepository,
    private readonly members: MemberRepository,
    private readonly categories: ExpenseCategoryRepository,
    private readonly idempotency: IdempotentCommandRunner,
  ) {}

  /**
   * A filtered, ordered, paged transaction list.
   *
   * The page is clamped rather than rejected for the same reason the member list clamps: a
   * stale bookmark should stay usable, and a page below 1 is not an error the Admin can act
   * on. A `pageSize` above the documented maximum is reduced to it, so one oversized request
   * cannot ask the database for an unbounded page.
   */
  public async list(request: TransactionListRequest): Promise<ApiListEnvelope<TransactionSummary>> {
    const filters = toQueryFilters(request);
    const pageSize = clampPageSize(request.pageSize);
    const page = Math.max(1, request.page ?? 1);
    const offset = (page - 1) * pageSize;

    const [rows, totalItems] = await Promise.all([
      this.transactions.list(filters, {
        limit: pageSize,
        offset,
        sort: request.sort ?? 'businessDate',
        direction: request.direction ?? 'desc',
      }),
      this.transactions.countMatching(filters),
    ]);

    return listEnvelope(rows.map(toTransactionSummary), { page, pageSize, totalItems });
  }

  public async detail(id: string): Promise<TransactionSummary> {
    return toTransactionSummary(await this.transactions.findWithRelations(id));
  }

  /**
   * Applies an audited correction, at most once for a given idempotency key.
   *
   * The revision the client read must arrive through `If-Match`; a mismatch is a conflict
   * rather than a last-write-wins overwrite, so two open edit forms cannot silently discard
   * one another's financial change. The revision and status guards are evaluated *inside*
   * the write transaction, so the check and the update cannot disagree.
   *
   * The type-specific rules are decided from a read taken before that transaction. Those
   * decisions rest on `transaction_type` and `income_type`, neither of which is editable, and
   * on a category's active status; a category deactivated in the microseconds between the two
   * reads is caught by the active-category check either way, so the window can only make a
   * correction fail closed, never write something invalid.
   */
  public async correct(
    id: string,
    input: CorrectTransactionDto,
    expectedRevision: number,
    actor: TransactionActor,
    idempotency: IdempotencyKey,
  ): Promise<TransactionSummary> {
    const current = await this.transactions.findWithRelations(id);
    const changes = await this.toCorrectableFields(current, input);

    const result = await this.idempotency.run<TransactionSummary>({
      adminUserId: actor.adminUserId,
      endpoint: `${CORRECT_ENDPOINT}/${id}`,
      idempotencyKey: idempotency.key,
      request: {
        expectedRevision,
        ...(input.amount === undefined ? {} : { amount: input.amount }),
        ...(input.paymentMethod === undefined ? {} : { paymentMethod: input.paymentMethod }),
        ...(input.businessDate === undefined ? {} : { businessDate: input.businessDate }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.memberId === undefined ? {} : { memberId: input.memberId }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      },
      run: async (tx) => {
        const updated = await this.transactions.correctWithinTransaction(
          tx,
          id,
          { ...changes, expectedRevision },
          { actorAdminId: actor.adminUserId, requestId: actor.requestId },
        );

        return { status: 200, body: toTransactionSummary(updated) };
      },
    });

    return result.body;
  }

  /**
   * Voids a transaction with a required reason, at most once for a given idempotency key.
   *
   * The row, its amount, and its references are kept. `REQ-FIN-018` excludes it from active
   * income, expenses, balances, contribution totals, and reports through its `status`, and
   * `REQ-FIN-019` records the reason, the actor, and the time — all of which the repository
   * writes atomically with the status change.
   *
   * Re-sending the identical request replays the original response rather than failing. That
   * matters because a void is irreversible: an Admin who taps confirm twice, or retries
   * after a timeout, must not receive an error that reads as "the void failed" when the void
   * in fact succeeded.
   */
  public async voidTransaction(
    id: string,
    reason: string,
    actor: TransactionActor,
    idempotency: IdempotencyKey,
  ): Promise<TransactionSummary> {
    const result = await this.idempotency.run<TransactionSummary>({
      adminUserId: actor.adminUserId,
      endpoint: `${VOID_ENDPOINT}/${id}`,
      idempotencyKey: idempotency.key,
      request: { reason: reason.trim() },
      run: async (tx) => {
        const voided = await this.transactions.voidWithinTransaction(tx, id, reason, {
          actorAdminId: actor.adminUserId,
          requestId: actor.requestId,
        });

        return { status: 200, body: toTransactionSummary(voided) };
      },
    });

    return result.body;
  }

  /** The transaction's full audit trail, oldest first. */
  public async auditTrail(id: string): Promise<readonly TransactionAuditEventView[]> {
    // Confirms the transaction exists first, so an unknown id is a 404 rather than an empty
    // history that would be indistinguishable from a record nothing ever happened to.
    await this.transactions.findById(id);

    const records = await this.audit.listForEntity(AUDIT_ENTITY_TYPES.transaction, id);

    return toAuditEventViews(records);
  }

  /**
   * The receipt projection for an income transaction.
   *
   * Generated from the persisted row on every request, so a corrected amount is reflected
   * immediately and a receipt is never a stale picture. A voided transaction still has one,
   * marked `VOIDED` (`REQ-DOC-013`).
   *
   * An expense has no receipt projection: receipts are an income concept in
   * `docs/01-REQUIREMENTS.md` (`REQ-DOC-010` applies to income types), and an expense
   * reports **Receipt Missing** or its attached documents instead. This answers
   * `400 VALIDATION_FAILED`, not `404`: the transaction exists and is readable, so a
   * `404` would report a missing record that is not missing. It matches
   * `requireIncomeRow`, which refuses an expense row for the same reason with the same
   * code. `docs/06-API-SPEC.md` scopes this projection to income types and does not
   * prescribe a status code for the expense case, so this is the transport decision
   * recorded in `docs/runtime/DECISIONS.md`.
   */
  public async receipt(id: string): Promise<TransactionReceiptView> {
    const row = await this.transactions.findWithRelations(id);

    if (row.transactionType !== 'INCOME') {
      throw validationFailed('A receipt is available for income transactions only.', {
        field: 'id',
      });
    }

    return toReceiptView(row);
  }

  /**
   * Reads a transaction and asserts it is income.
   *
   * Used by the income module so `GET /income/:id` cannot return an expense and the income
   * receipt route cannot be reached through an expense identifier.
   */
  public async requireIncomeRow(id: string): Promise<TransactionWithRelations> {
    const row = await this.transactions.findWithRelations(id);

    if (row.transactionType !== 'INCOME') {
      throw validationFailed('That transaction is not an income record.', { field: 'id' });
    }

    return row;
  }

  /**
   * Translates a validated correction body into the repository's correctable fields,
   * rejecting anything the transaction's type does not permit.
   *
   * Returning a partial object rather than the DTO matters: `undefined` fields are left
   * untouched by the repository, which is what makes a partial correction possible without
   * overwriting fields the Admin did not mean to change. An explicit `null`, in contrast, is a
   * deliberate clearing of a nullable field, and it is only produced where the type allows
   * one.
   *
   * The *status* and *revision* guards are deliberately absent here. Editing a voided
   * transaction is a state conflict, not a malformed request, so the request body is
   * perfectly valid and the answer must be a `409 CONFLICT` — the same answer a stale
   * revision gets. It is also a check that must not be made from a pre-transaction read: a
   * void committed between that read and the write would otherwise be silently overwritten.
   * `correctWithinTransaction` therefore performs both guards inside the write transaction
   * and raises them there, so the check and the update can never disagree.
   */
  private async toCorrectableFields(
    current: TransactionWithRelations,
    input: CorrectTransactionDto,
  ): Promise<{
    readonly amountPaise?: bigint;
    readonly paymentMethod?: PaymentMethod;
    readonly businessDate?: Date;
    readonly description?: string;
    readonly notes?: string;
    readonly memberId?: string | null;
    readonly categoryId?: string | null;
  }> {
    const changes: {
      amountPaise?: bigint;
      paymentMethod?: PaymentMethod;
      businessDate?: Date;
      description?: string;
      notes?: string;
      memberId?: string | null;
      categoryId?: string | null;
    } = {};

    if (input.amount !== undefined) {
      changes.amountPaise = parseAmountPaise(input.amount);
    }

    if (input.paymentMethod !== undefined) {
      changes.paymentMethod = input.paymentMethod;
    }

    if (input.businessDate !== undefined) {
      changes.businessDate = parseBusinessDateValue(input.businessDate);
    }

    if (input.description !== undefined) {
      changes.description = input.description;
    }

    if (input.notes !== undefined) {
      changes.notes = input.notes;
    }

    if (current.transactionType === 'INCOME') {
      await this.applyIncomeCorrectionRules(current, input, changes);
    } else {
      await this.applyExpenseCorrectionRules(input, changes);
    }

    return changes;
  }

  /**
   * The income-only correction rules.
   *
   * `REQ-INCOME-003` makes the member mandatory for a member contribution, and the database
   * trigger additionally requires the linked period to belong to that member. Re-linking the
   * member would therefore have to move the period as well, which is a different operation
   * from correcting an amount, so it is refused here rather than half-applied.
   *
   * `REQ-INCOME-005` and `REQ-INCOME-006` mean an anonymous donation can never acquire a
   * member, a custom description, or a note. The stored description is the server-owned
   * neutral value, and a note is the most likely place for a donor's name to be typed, so
   * both are refused rather than silently dropped — a silent drop would leave the Admin
   * believing a note was saved.
   */
  private async applyIncomeCorrectionRules(
    current: TransactionWithRelations,
    input: CorrectTransactionDto,
    changes: {
      description?: string;
      notes?: string;
      memberId?: string | null;
      categoryId?: string | null;
    },
  ): Promise<void> {
    if (input.categoryId !== undefined) {
      throw validationFailed('An income transaction cannot have a category.', {
        field: 'categoryId',
      });
    }

    const anonymous = current.incomeType !== null && isAnonymousIncomeType(current.incomeType);

    if (anonymous) {
      if (input.memberId !== undefined) {
        throw validationFailed('An anonymous donation cannot identify a member.', {
          field: 'memberId',
        });
      }

      if (input.description !== undefined || input.notes !== undefined) {
        throw validationFailed(
          'An anonymous donation uses the fixed description and cannot carry a note.',
          { field: input.notes !== undefined ? 'notes' : 'description' },
        );
      }
    }

    if (input.memberId !== undefined) {
      if (current.incomeType === 'MEMBER_CONTRIBUTION') {
        throw validationFailed(
          'A member contribution cannot be moved to a different member. Void it and record a new contribution instead.',
          { field: 'memberId' },
        );
      }

      // An Offering or Donation may identify a member when appropriate, and `null` detaches
      // one, which is how a mis-keyed named donation is made anonymous again. The member is
      // confirmed first so an unknown id is the documented 404 rather than a foreign-key
      // failure reported as a server error.
      if (input.memberId !== null) {
        await this.members.findById(input.memberId);
      }

      changes.memberId = input.memberId;
    }
  }

  /**
   * The expense-only correction rules.
   *
   * An expense cannot acquire an income association, and `REQ-EXP-004` requires it to keep
   * exactly one active category, so a correction may point at a different active category but
   * can never clear it. The target category is validated here rather than trusted, so a
   * correction cannot file an expense under a category that was deactivated in the meantime.
   */
  private async applyExpenseCorrectionRules(
    input: CorrectTransactionDto,
    changes: { memberId?: string | null; categoryId?: string | null },
  ): Promise<void> {
    if (input.memberId !== undefined) {
      throw validationFailed('An expense cannot identify a member.', { field: 'memberId' });
    }

    if (input.categoryId !== undefined) {
      if (input.categoryId === null) {
        throw validationFailed('An expense requires a category.', { field: 'categoryId' });
      }

      await this.categories.requireActive(input.categoryId);
      changes.categoryId = input.categoryId;
    }
  }
}

/**
 * Builds the repository filter set from a validated request.
 *
 * Range validation happens here rather than in the database: an inverted date range or an
 * amount window whose minimum exceeds its maximum matches nothing, and an empty result would
 * read to the Admin as "no transactions in that period" instead of "those bounds are
 * impossible". `REQ-FIN-022` requires invalid date ranges to be rejected safely.
 */
function toQueryFilters(request: TransactionListRequest): TransactionQueryFilters {
  const from = request.from === undefined ? undefined : parseBusinessDateValue(request.from);
  const to = request.to === undefined ? undefined : parseBusinessDateValue(request.to);

  if (from !== undefined && to !== undefined && from.getTime() > to.getTime()) {
    throw validationFailed('The start date must not be after the end date.', { field: 'from' });
  }

  const minAmountPaise =
    request.minAmount === undefined ? undefined : parseFilterPaise(request.minAmount, 'minAmount');
  const maxAmountPaise =
    request.maxAmount === undefined ? undefined : parseFilterPaise(request.maxAmount, 'maxAmount');

  if (
    minAmountPaise !== undefined &&
    maxAmountPaise !== undefined &&
    minAmountPaise > maxAmountPaise
  ) {
    throw validationFailed('The minimum amount must not be greater than the maximum amount.', {
      field: 'minAmount',
    });
  }

  const search = request.search?.trim();

  return {
    ...(request.transactionType === undefined ? {} : { transactionType: request.transactionType }),
    ...(request.incomeType === undefined ? {} : { incomeType: request.incomeType }),
    ...(request.status === undefined ? {} : { status: request.status }),
    ...(request.paymentMethod === undefined ? {} : { paymentMethod: request.paymentMethod }),
    ...(request.memberId === undefined ? {} : { memberId: request.memberId }),
    ...(request.categoryId === undefined ? {} : { categoryId: request.categoryId }),
    ...(request.reference === undefined ? {} : { referenceId: request.reference }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(minAmountPaise === undefined ? {} : { minAmountPaise }),
    ...(maxAmountPaise === undefined ? {} : { maxAmountPaise }),
    // An empty search box is not a filter. Sending `contains: ''` would match every row and
    // claim the Admin searched for something, so it is dropped instead.
    ...(search === undefined || search === '' ? {} : { search }),
  };
}

function clampPageSize(requested: number | undefined): number {
  if (requested === undefined) {
    return TRANSACTION_PAGE_SIZE_DEFAULT;
  }

  return Math.min(Math.max(1, Math.trunc(requested)), TRANSACTION_PAGE_SIZE_MAX);
}

/**
 * Parses a stored amount from a client string.
 *
 * The strict parser rejects signs, exponents, grouping, and more than two fraction digits, so
 * `"1,000"`, `"1e3"`, and `"10.005"` are all rejected rather than coerced. Zero is rejected
 * too, because `financial_transaction` has an `amount_paise > 0` constraint and saving a zero
 * contribution would be a meaningless financial record.
 */
export function parseAmountPaise(raw: string): bigint {
  let paise: bigint;

  try {
    paise = parsePaise(raw);
  } catch {
    throw validationFailed(
      'Enter an amount such as 500 or 500.00, with at most two decimal places.',
      {
        field: 'amount',
      },
    );
  }

  if (paise === 0n) {
    throw validationFailed('The amount must be greater than zero.', { field: 'amount' });
  }

  return paise;
}

/**
 * Parses an amount *filter* bound, which may legitimately be zero.
 *
 * A minimum of `"0"` means "no minimum" rather than "exactly zero", and rejecting it would
 * make it impossible to ask for every transaction up to a maximum.
 */
function parseFilterPaise(raw: string, field: string): bigint {
  try {
    return parsePaise(raw);
  } catch {
    throw validationFailed(
      'Enter an amount such as 500 or 500.00, with at most two decimal places.',
      { field },
    );
  }
}

/** Parses a business date with a field-level message instead of a raw format error. */
export function parseBusinessDateValue(raw: string): Date {
  try {
    return parseBusinessDate(raw);
  } catch {
    throw validationFailed('Enter a business date as YYYY-MM-DD.', { field: 'businessDate' });
  }
}

/** Re-exported so the income and expense modules format money identically. */
export { formatPaise };
