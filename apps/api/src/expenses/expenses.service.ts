import { Injectable } from '@nestjs/common';
import type { ExpenseCategory } from '@prisma/client';
import {
  list as listEnvelope,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  TRANSACTION_PAGE_SIZE_MAX,
  type ApiListEnvelope,
  type ExpenseCategoryView,
  type ExpenseSummary,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import { IdempotentCommandRunner, type IdempotencyKey } from '../common/http/idempotency';
import { startOfBusinessDay } from '../common/time/business-date';
import { ExpenseCategoryRepository } from '../database/categories/expense-category.repository';
import { TransactionRepository } from '../database/transactions/transaction.repository';
import { toExpenseSummary } from '../transactions/transaction-mapper';
import {
  parseAmountPaise,
  parseBusinessDateValue,
  toQueryFilters,
  type TransactionActor,
  type TransactionListRequest,
} from '../transactions/transactions.service';
import type {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  UpdateExpenseCategoryDto,
} from './dto/expense.dto';

const EXPENSE_ENDPOINT = 'POST /api/v1/expenses';
const CATEGORY_CREATE_ENDPOINT = 'POST /api/v1/expenses/categories';
const CATEGORY_UPDATE_ENDPOINT = 'PATCH /api/v1/expenses/categories';

/**
 * Expense commands, category configuration, and expense reads.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-EXP-001` to `REQ-EXP-004` and `REQ-DOC-003`;
 * transport from `docs/06-API-SPEC.md`. Correction, void, and audit are **not** implemented
 * here: they are shared transaction behaviour and live in `TransactionsService`, which is
 * what guarantees a void behaves identically for income and expenses. An expense is read
 * through this service so the browser has one expense-shaped endpoint, and the underlying
 * query is the same ledger query `/transactions` uses with the type forced — there is no
 * second read path that could disagree with the totals.
 *
 * The four rules this service owns, and refuses to delegate:
 *
 * 1. **An expense always has exactly one active category.** Checked before the write, so an
 *    unknown or deactivated category is a documented `400` naming the field rather than a
 *    foreign-key failure the Admin would read as a server fault (`REQ-EXP-004`).
 * 2. **An expense belongs to the church, not to a member.** The create DTO has no `memberId`,
 *    and the global pipe rejects unknown body keys, so a request that tries to attach one is
 *    refused at the transport boundary rather than silently dropped.
 * 3. **Categories are renamed and deactivated, never deleted.** History keeps the label it was
 *    recorded with, and the *current* status travels with it so the UI can explain why a
 *    category is no longer offered for a new entry (`docs/05-DATABASE-SPEC.md`).
 * 4. **Every write is idempotent.** The financial write, its `HY-EXP-` reference, its audit
 *    event, and the stored idempotency response all commit in one transaction, so a double tap
 *    on Save records one expense rather than two.
 */
@Injectable()
export class ExpensesService {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly categories: ExpenseCategoryRepository,
    private readonly idempotency: IdempotentCommandRunner,
  ) {}

  /**
   * Records an expense transaction, at most once per idempotency key.
   *
   * `occurred_at` is the recorded instant and `business_date` is the Asia/Kolkata accounting
   * date. Deriving the instant from the start of that business day keeps the two consistent,
   * so an entry for 25 Sep is recorded inside 25 Sep and is never shifted a day by a UTC or
   * server-timezone conversion — the same rule the income path uses, so one entry cannot
   * appear in a different month than the one the Admin typed.
   */
  public async create(
    input: CreateExpenseDto,
    actor: TransactionActor,
    idempotency: IdempotencyKey,
  ): Promise<ExpenseSummary> {
    const businessDate = parseBusinessDateValue(input.businessDate);
    const amountPaise = parseAmountPaise(input.amount);

    // Confirmed before the write so the failure is the documented one and no partial record is
    // left behind. `requireActive` also re-reads the category's status, so a category
    // deactivated between this check and the write can only make the request fail closed.
    await this.categories.requireActive(input.categoryId);

    const occurredAt = startOfBusinessDay(businessDate);
    const description = input.description ?? null;
    const notes = input.notes ?? null;

    const result = await this.idempotency.run<ExpenseSummary>({
      adminUserId: actor.adminUserId,
      endpoint: EXPENSE_ENDPOINT,
      idempotencyKey: idempotency.key,
      // The validated body, reduced to what was actually honoured, so a retry of the same form
      // hashes identically while a genuinely different request is caught as key reuse.
      request: {
        amount: input.amount.trim(),
        paymentMethod: input.paymentMethod,
        businessDate: input.businessDate.trim(),
        categoryId: input.categoryId,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      },
      run: async (tx) => {
        const created = await this.transactions.createWithinTransaction(
          tx,
          {
            transactionType: 'EXPENSE',
            amountPaise,
            paymentMethod: input.paymentMethod,
            businessDate,
            occurredAt,
            description,
            notes,
            categoryId: input.categoryId,
          },
          { actorAdminId: actor.adminUserId, requestId: actor.requestId },
        );

        return { status: 201, body: toExpenseSummary(created) };
      },
    });

    return result.body;
  }

  /**
   * The expense list, as a page of the shared ledger query.
   *
   * `transactionType` is forced to `EXPENSE` here rather than trusted from the request, and
   * `incomeType` is not part of the DTO at all, so this route cannot be widened into an income
   * list even by a caller that ignores the whitelist. Paging is clamped for the same reason
   * the shared list clamps it: a stale bookmark should stay usable and one oversized request
   * must not ask the database for an unbounded page.
   */
  public async list(request: TransactionListRequest): Promise<ApiListEnvelope<ExpenseSummary>> {
    const pageSize = clampPageSize(request.pageSize);
    const page = Math.max(1, request.page ?? 1);
    const offset = (page - 1) * pageSize;

    // The forced type replaces anything the caller supplied, so `type` cannot override it even
    // if a future change widened the DTO. The range and amount-window rules are the shared
    // transaction ones rather than a second hand-written parser, so an expense list can never
    // accept a bound the income list rejects (`REQ-FIN-022`).
    const filters = { ...toQueryFilters(request), transactionType: 'EXPENSE' as const };

    const [rows, totalItems] = await Promise.all([
      this.transactions.list(filters, {
        limit: pageSize,
        offset,
        sort: request.sort ?? 'businessDate',
        direction: request.direction ?? 'desc',
      }),
      this.transactions.countMatching(filters),
    ]);

    return listEnvelope(rows.map(toExpenseSummary), { page, pageSize, totalItems });
  }

  /**
   * Every category a new expense may use.
   *
   * `docs/05-DATABASE-SPEC.md`: "The API exposes active categories for new entries and preserves
   * inactive categories on historical transactions", and `docs/06-API-SPEC.md` documents this
   * route as the active categories. Only `ACTIVE` rows are therefore returned, and the inactive
   * status travels on the transaction instead: `TransactionCategoryRef` carries the category's
   * status at read time, so a historical expense still explains why a category it was filed
   * under is no longer offered for a new entry.
   *
   * Returning the inactive rows here as well would put a category in the create form's dropdown
   * that the server then refuses, which is precisely the dead control the state-honesty rule
   * forbids. Phase 10 owns the Settings entry point that has to *reactivate* one, and may widen
   * this route with an explicit status filter at that point.
   *
   * This is a plain data array rather than a paged envelope: the set is a bounded
   * configuration list, not a ledger, and pagination would add a pager to a dropdown.
   */
  public async listCategories(): Promise<readonly ExpenseCategoryView[]> {
    return (await this.categories.findActive()).map(toExpenseCategoryView);
  }

  /**
   * Adds a custom category, at most once per idempotency key.
   *
   * `isSystem` is not part of the request: the initial set is a documented product set
   * (`REQ-EXP-001`) that only the seed marks, so an Admin-created category is always custom
   * and cannot claim membership of the product set.
   */
  public async createCategory(
    input: CreateExpenseCategoryDto,
    actor: TransactionActor,
    idempotency: IdempotencyKey,
  ): Promise<ExpenseCategoryView> {
    const name = input.name.trim();

    const result = await this.idempotency.run<ExpenseCategoryView>({
      adminUserId: actor.adminUserId,
      endpoint: CATEGORY_CREATE_ENDPOINT,
      idempotencyKey: idempotency.key,
      request: { name },
      run: async (tx) => {
        const created = await this.categories.createWithinTransaction(tx, name, actor.adminUserId);

        return { status: 201, body: toExpenseCategoryView(created) };
      },
    });

    return result.body;
  }

  /**
   * Renames a category or activates/deactivates it, at most once per idempotency key.
   *
   * Deactivating is not deleting: the row survives, every historical expense keeps the label it
   * was recorded with, and the change is audited with the before and after values. A request
   * that changes nothing is refused, because an audit event with identical before and after
   * values would make the history misleading.
   */
  public async updateCategory(
    id: string,
    input: UpdateExpenseCategoryDto,
    actor: TransactionActor,
    idempotency: IdempotencyKey,
  ): Promise<ExpenseCategoryView> {
    if (input.name === undefined && input.status === undefined) {
      throw validationFailed('A category change must set a new name or a new status.', {
        field: input.name === undefined ? 'status' : 'name',
      });
    }

    const name = input.name?.trim();
    const status = input.status;

    const result = await this.idempotency.run<ExpenseCategoryView>({
      adminUserId: actor.adminUserId,
      endpoint: `${CATEGORY_UPDATE_ENDPOINT}/${id}`,
      idempotencyKey: idempotency.key,
      request: {
        ...(name === undefined ? {} : { name }),
        ...(status === undefined ? {} : { status }),
      },
      run: async (tx) => {
        const updated = await this.categories.updateWithinTransaction(
          tx,
          id,
          { ...(name === undefined ? {} : { name }), ...(status === undefined ? {} : { status }) },
          actor.adminUserId,
        );

        return { status: 200, body: toExpenseCategoryView(updated) };
      },
    });

    return result.body;
  }
}

/**
 * The one place a persisted category becomes an API payload.
 *
 * `isSystem` is included because a system category is a documented product set while a custom
 * one is the Admin's own configuration, and Phase 10's Settings screen presents them
 * differently. The *current* status is returned rather than dropped, so a historical expense
 * still carries the status of the category it was filed under and the UI can explain it.
 */
export function toExpenseCategoryView(row: ExpenseCategory): ExpenseCategoryView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clampPageSize(requested: number | undefined): number {
  if (requested === undefined) {
    return TRANSACTION_PAGE_SIZE_DEFAULT;
  }

  return Math.min(Math.max(1, Math.trunc(requested)), TRANSACTION_PAGE_SIZE_MAX);
}
