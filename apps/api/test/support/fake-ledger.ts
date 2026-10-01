import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import {
  conflict,
  notFound,
  staleRevision,
  validationFailed,
} from '../../src/common/errors/domain.errors';
import { parseBusinessDate } from '../../src/common/time/business-date';
import { hashToken } from '../../src/auth/token.util';
import type { AuthenticatedSession } from '../../src/auth/session.service';
import { normalizeCategoryName } from '../../src/database/categories/expense-category.repository';
import type {
  CorrectableTransactionFields,
  CreateTransactionInput,
  TransactionCommandContext,
  TransactionQueryFilters,
  TransactionSortDirection,
  TransactionSortField,
} from '../../src/database/transactions/transaction.repository';

/**
 * In-memory doubles shared by the income, expense, and member HTTP suites.
 *
 * Authority: none of these are production code. They exist so the HTTP contract — routing,
 * authentication, CSRF, idempotency, `If-Match` parsing, exact money parsing, the type-specific
 * rules, the documented error envelopes, and the read/audit/receipt projections — can be proven
 * with no PostgreSQL. The behaviour that genuinely needs a database (reference allocation under
 * concurrency, unique-constraint races, CHECK constraints, triggers, grants, and
 * least-privilege behaviour) is covered by `test/database/*.db-spec.ts` instead.
 *
 * They are shared rather than duplicated on purpose. Each double mirrors the rule of the
 * repository it stands in for — exact-paise amounts, the `HY-INC-`/`HY-EXP-` reference
 * allocation, the `search` haystack that deliberately excludes `notes`, the status and
 * revision guards, the category lifecycle, and the audit snapshot keys. A double that answered
 * more permissively than production would make a suite pass for the wrong reason, and a
 * *second* copy of the same double is how the two copies start to disagree.
 */

/** The Admin every suite acts as. Audit attribution compares against this id. */
export const TEST_ACTOR_ADMIN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const TEST_ACTOR_DISPLAY_NAME = 'Admin';

export type Snapshot = Readonly<Record<string, string | number | boolean | null>>;

export interface FakeTransactionRow {
  id: string;
  referenceId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  incomeType: string | null;
  amountPaise: bigint;
  paymentMethod: string;
  businessDate: Date;
  occurredAt: Date;
  description: string | null;
  notes: string | null;
  memberId: string | null;
  contributionPeriodId: string | null;
  categoryId: string | null;
  status: 'ACTIVE' | 'VOIDED';
  voidReason: string | null;
  voidedAt: Date | null;
  createdByAdminId: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  documentCount: number;
}

export interface FakeAuditEvent {
  id: string;
  entityId: string;
  action: string;
  actorDisplayName: string | null;
  occurredAt: Date;
  reason: string | null;
  requestId: string | null;
  before: Snapshot | null;
  after: Snapshot | null;
}

export interface FakeMember {
  id: string;
  referenceId: string;
  name: string;
}

export interface FakePeriod {
  id: string;
  memberId: string;
  year: number;
  month: number;
  expectedPaise: bigint;
}

export interface FakeCategory {
  id: string;
  name: string;
  normalizedName: string;
  status: 'ACTIVE' | 'INACTIVE';
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The shared ledger the transaction and audit doubles read.
 *
 * The audit double is a separate Nest provider but reads the same events, so a correction
 * recorded through the transaction double is visible through the audit route without the
 * double inventing its own copy.
 */
export class FakeLedger {
  public readonly rows: FakeTransactionRow[] = [];
  public readonly events: FakeAuditEvent[] = [];

  public constructor(rows: readonly FakeTransactionRow[]) {
    this.rows.push(...rows);
  }

  public row(id: string): FakeTransactionRow | undefined {
    return this.rows.find((candidate) => candidate.id === id);
  }

  /** Mirrors the repository's flat audit snapshot, including its paise-as-string amounts. */
  public snapshot(row: FakeTransactionRow): Snapshot {
    return {
      referenceId: row.referenceId,
      transactionType: row.transactionType,
      amountPaise: row.amountPaise.toString(),
      paymentMethod: row.paymentMethod,
      status: row.status,
      businessDate: row.businessDate.toISOString().slice(0, 10),
      description: row.description,
      notes: row.notes,
      incomeType: row.incomeType,
      memberId: row.memberId,
      contributionPeriodId: row.contributionPeriodId,
      categoryId: row.categoryId,
      voidReason: row.voidReason,
      revision: row.revision,
    };
  }

  public record(
    row: FakeTransactionRow,
    action: string,
    before: Snapshot | null,
    reason: string | null,
    context: { actorAdminId: string; requestId?: string | null },
  ): void {
    this.events.push({
      id: `audit-${String(this.events.length + 1).padStart(4, '0')}`,
      entityId: row.id,
      action,
      actorDisplayName:
        context.actorAdminId === TEST_ACTOR_ADMIN_ID ? TEST_ACTOR_DISPLAY_NAME : null,
      occurredAt: new Date('2026-09-10T06:00:00.000Z'),
      reason,
      requestId: context.requestId ?? null,
      before,
      after: this.snapshot(row),
    });
  }
}

/**
 * The transaction persistence double.
 *
 * Every rule here is copied from `transaction.repository.ts`: reference allocation per type,
 * the "a correction must change something" guard, the voided-status and revision guards, and
 * the audit write that commits with the change.
 */
export class FakeTransactions {
  public readonly createCalls: {
    readonly input: CreateTransactionInput;
    readonly context: TransactionCommandContext;
  }[] = [];

  public readonly correctCalls: {
    readonly id: string;
    readonly changes: CorrectableTransactionFields & { readonly expectedRevision: number };
    readonly context: TransactionCommandContext;
  }[] = [];

  public readonly voidCalls: {
    readonly id: string;
    readonly reason: string;
    readonly context: TransactionCommandContext;
  }[] = [];

  public constructor(
    private readonly ledger: FakeLedger,
    private readonly members: readonly FakeMember[],
    private readonly periods: readonly FakePeriod[],
    private readonly categories: readonly FakeCategory[],
  ) {}

  /** A row with the relations the single transaction projection reads. */
  private withRelations(row: FakeTransactionRow) {
    const member = this.members.find((candidate) => candidate.id === row.memberId) ?? null;
    const category = this.categories.find((candidate) => candidate.id === row.categoryId) ?? null;
    const period = this.periods.find((candidate) => candidate.id === row.contributionPeriodId);

    return {
      ...row,
      member:
        member === null
          ? null
          : { id: member.id, referenceId: member.referenceId, name: member.name },
      category:
        category === null
          ? null
          : { id: category.id, name: category.name, status: category.status },
      contributionPeriod:
        period === undefined ? null : { id: period.id, year: period.year, month: period.month },
      _count: { documents: row.documentCount },
    };
  }

  public async findById(id: string): Promise<FakeTransactionRow> {
    const found = this.ledger.row(id);

    if (found === undefined) {
      throw notFound('Transaction', id);
    }

    return found;
  }

  public async findWithRelations(id: string) {
    return this.withRelations(await this.findById(id));
  }

  public async findByReferenceId(referenceId: string): Promise<FakeTransactionRow> {
    const found = this.ledger.rows.find((candidate) => candidate.referenceId === referenceId);

    if (found === undefined) {
      throw notFound('Transaction', referenceId);
    }

    return found;
  }

  public async list(
    filters: TransactionQueryFilters,
    options: {
      readonly limit: number;
      readonly offset: number;
      readonly sort: TransactionSortField;
      readonly direction: TransactionSortDirection;
    },
  ) {
    return this.matching(filters)
      .sort((left, right) => compareRows(left, right, options.sort, options.direction))
      .slice(options.offset, options.offset + options.limit)
      .map((row) => this.withRelations(row));
  }

  public async countMatching(filters: TransactionQueryFilters): Promise<number> {
    return this.matching(filters).length;
  }

  public async createWithinTransaction(
    _tx: unknown,
    input: CreateTransactionInput,
    context: TransactionCommandContext,
  ) {
    this.createCalls.push({ input, context });

    const incomeCount = this.ledger.rows.filter((row) => row.transactionType === 'INCOME').length;
    const expenseCount = this.ledger.rows.filter((row) => row.transactionType === 'EXPENSE').length;
    const created: FakeTransactionRow = {
      // A real UUID, as `gen_random_uuid()` produces, so a record created here can be addressed
      // by the routes that validate the id and a non-UUID cannot pass as a real identifier.
      id: `0000c000-0000-4000-8000-${String(this.ledger.rows.length + 1).padStart(12, '0')}`,
      referenceId:
        input.transactionType === 'INCOME'
          ? `HY-INC-${String(incomeCount + 1).padStart(6, '0')}`
          : `HY-EXP-${String(expenseCount + 1).padStart(6, '0')}`,
      transactionType: input.transactionType,
      incomeType: input.incomeType ?? null,
      amountPaise: input.amountPaise,
      paymentMethod: input.paymentMethod,
      businessDate: input.businessDate,
      occurredAt: input.occurredAt,
      description: input.description ?? null,
      notes: input.notes ?? null,
      memberId: input.memberId ?? null,
      contributionPeriodId: input.contributionPeriodId ?? null,
      categoryId: input.categoryId ?? null,
      status: 'ACTIVE',
      voidReason: null,
      voidedAt: null,
      createdByAdminId: context.actorAdminId,
      revision: 1,
      createdAt: new Date('2026-09-10T06:00:00.000Z'),
      updatedAt: new Date('2026-09-10T06:00:00.000Z'),
      documentCount: 0,
    };

    this.ledger.rows.push(created);
    this.ledger.record(created, 'TRANSACTION_CREATED', null, null, context);

    return this.withRelations(created);
  }

  public async correctWithinTransaction(
    _tx: unknown,
    id: string,
    input: CorrectableTransactionFields & { readonly expectedRevision: number },
    context: TransactionCommandContext,
  ) {
    this.correctCalls.push({ id, changes: input, context });

    // `expectedRevision` is the concurrency guard, not a change. The repository strips it
    // before counting, so a body that changes nothing is refused even though the guard is
    // always present on the call.
    const { expectedRevision, ...changes } = input;

    if (Object.keys(changes).length === 0) {
      throw validationFailed('A correction must change at least one field.');
    }

    const current = this.ledger.row(id);

    if (current === undefined) {
      throw notFound('Transaction', id);
    }

    if (current.status === 'VOIDED') {
      throw conflict('A voided transaction cannot be edited.', { field: 'status' });
    }

    if (current.revision !== expectedRevision) {
      throw staleRevision('Transaction', expectedRevision, current.revision);
    }

    const before = this.ledger.snapshot(current);

    Object.assign(current, {
      ...(changes.amountPaise === undefined ? {} : { amountPaise: changes.amountPaise }),
      ...(changes.paymentMethod === undefined ? {} : { paymentMethod: changes.paymentMethod }),
      ...(changes.businessDate === undefined ? {} : { businessDate: changes.businessDate }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
      ...(changes.notes === undefined ? {} : { notes: changes.notes }),
      ...(changes.categoryId === undefined ? {} : { categoryId: changes.categoryId }),
      // `null` is a meaningful correction, not an absent field: it is how a mis-keyed member
      // is detached, so it must be applied rather than skipped.
      ...(changes.memberId === undefined ? {} : { memberId: changes.memberId }),
      revision: current.revision + 1,
      updatedAt: new Date('2026-09-10T06:00:00.000Z'),
    });
    this.ledger.record(current, 'TRANSACTION_UPDATED', before, null, context);

    return this.withRelations(current);
  }

  public async voidWithinTransaction(
    _tx: unknown,
    id: string,
    reason: string,
    context: TransactionCommandContext,
  ) {
    this.voidCalls.push({ id, reason, context });

    const voidReason = reason.trim();

    if (voidReason === '') {
      throw validationFailed('A void reason is required.', { field: 'reason' });
    }

    const current = this.ledger.row(id);

    if (current === undefined) {
      throw notFound('Transaction', id);
    }

    if (current.status === 'VOIDED') {
      if (current.voidReason === voidReason) {
        return this.withRelations(current);
      }

      throw conflict('This transaction is already voided with a different reason.', {
        field: 'reason',
      });
    }

    const before = this.ledger.snapshot(current);

    current.status = 'VOIDED';
    current.voidReason = voidReason;
    current.voidedAt = new Date('2026-09-10T06:00:00.000Z');
    current.revision += 1;
    current.updatedAt = current.voidedAt;
    this.ledger.record(current, 'TRANSACTION_VOIDED', before, voidReason, context);

    return this.withRelations(current);
  }

  /**
   * The documented filter set, applied exactly as `toPrismaWhere` applies it.
   *
   * `search` covers the reference, the description, the member's name and reference, and the
   * category name — and deliberately not `notes`, which is how an identity written into a
   * private note would otherwise become attributable through the search box.
   */
  private matching(filters: TransactionQueryFilters): FakeTransactionRow[] {
    const term = filters.search?.toLowerCase() ?? '';

    return this.ledger.rows.filter((row) => {
      if (
        filters.transactionType !== undefined &&
        row.transactionType !== filters.transactionType
      ) {
        return false;
      }

      if (filters.status !== undefined && row.status !== filters.status) {
        return false;
      }

      if (filters.paymentMethod !== undefined && row.paymentMethod !== filters.paymentMethod) {
        return false;
      }

      if (filters.incomeType !== undefined && row.incomeType !== filters.incomeType) {
        return false;
      }

      if (filters.categoryId !== undefined && row.categoryId !== filters.categoryId) {
        return false;
      }

      if (filters.memberId !== undefined && row.memberId !== filters.memberId) {
        return false;
      }

      if (filters.referenceId !== undefined && row.referenceId !== filters.referenceId) {
        return false;
      }

      if (filters.from !== undefined && row.businessDate.getTime() < filters.from.getTime()) {
        return false;
      }

      if (filters.to !== undefined && row.businessDate.getTime() > filters.to.getTime()) {
        return false;
      }

      if (filters.minAmountPaise !== undefined && row.amountPaise < filters.minAmountPaise) {
        return false;
      }

      if (filters.maxAmountPaise !== undefined && row.amountPaise > filters.maxAmountPaise) {
        return false;
      }

      if (term === '') {
        return true;
      }

      const member = this.members.find((candidate) => candidate.id === row.memberId);
      const category = this.categories.find((candidate) => candidate.id === row.categoryId);
      const haystack = [
        row.referenceId,
        row.description ?? '',
        member?.name ?? '',
        member?.referenceId ?? '',
        category?.name ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  }
}

/** The audit read double. It never invents events; it reports what the ledger recorded. */
export class FakeAudit {
  public constructor(private readonly ledger: FakeLedger) {}

  public async listForEntity(entityType: string, entityId: string) {
    // `entityType` is asserted rather than ignored: the history route must read the
    // transaction trail, not some other entity's.
    if (entityType !== 'financial_transaction') {
      return [];
    }

    return this.ledger.events.filter((event) => event.entityId === entityId);
  }

  public async countForEntity(entityType: string, entityId: string): Promise<number> {
    return (await this.listForEntity(entityType, entityId)).length;
  }
}

export class FakeMembers {
  public constructor(private readonly members: readonly FakeMember[]) {}

  public async findById(id: string): Promise<FakeMember> {
    const found = this.members.find((member) => member.id === id);

    if (found === undefined) {
      throw notFound('Member', id);
    }

    return found;
  }
}

export class FakePeriods {
  public readonly opened: {
    readonly memberId: string;
    readonly year: number;
    readonly month: number;
    readonly expectedPaise: bigint;
  }[] = [];

  public readonly actors: string[] = [];

  public constructor(private readonly periods: FakePeriod[]) {}

  public async findOrCreateWithinTransaction(
    _tx: unknown,
    input: { memberId: string; year: number; month: number; expectedPaise: bigint },
    actorAdminId: string,
  ): Promise<FakePeriod> {
    const existing = this.periods.find(
      (period) =>
        period.memberId === input.memberId &&
        period.year === input.year &&
        period.month === input.month,
    );

    if (existing !== undefined) {
      return existing;
    }

    const created: FakePeriod = {
      id: `period-${String(this.periods.length + 1).padStart(4, '0')}`,
      memberId: input.memberId,
      year: input.year,
      month: input.month,
      expectedPaise: input.expectedPaise,
    };

    this.periods.push(created);
    this.opened.push(input);
    // The period a contribution opens belongs to the Admin who recorded the contribution, so
    // the double records the actor it was handed and the test asserts the authenticated one.
    this.actors.push(actorAdminId);

    return created;
  }

  public async summarizeMany(periodIds: readonly string[]) {
    return Promise.all(
      periodIds.map(async (id) => {
        const period = this.periods.find((candidate) => candidate.id === id);

        if (period === undefined) {
          throw notFound('Contribution period', id);
        }

        return { period, receivedPaise: 0n };
      }),
    );
  }
}

export class FakeSettings {
  public constructor(private readonly values: Readonly<Record<string, string>>) {}

  public async findOne(key: string) {
    const value = this.values[key];

    if (value === undefined) {
      throw notFound('App setting', key);
    }

    return { key, value };
  }
}

/**
 * The category double, including the rename/deactivate lifecycle.
 *
 * Uniqueness is enforced case-insensitively through `normalizedName`, exactly as the
 * `expense_category_normalized_name_is_normalized` CHECK constraint does, so a suite cannot
 * create two categories that differ only by casing or surrounding whitespace — which is the
 * duplicate `REQ-EXP-002` exists to prevent.
 *
 * There is no delete. `docs/05-DATABASE-SPEC.md` says a category is deactivated so historical
 * expenses keep the label they were recorded with, and a double with a delete would let a suite
 * pass for a shape the schema cannot hold.
 */
export class FakeCategories {
  public readonly created: { readonly name: string; readonly actorAdminId: string }[] = [];

  public readonly updated: {
    readonly id: string;
    readonly changes: { readonly name?: string; readonly status?: 'ACTIVE' | 'INACTIVE' };
    readonly actorAdminId: string;
  }[] = [];

  public constructor(private readonly categories: FakeCategory[]) {}

  public async findAll(): Promise<readonly FakeCategory[]> {
    return [...this.categories].sort((left, right) => left.name.localeCompare(right.name));
  }

  public async findActive(): Promise<readonly FakeCategory[]> {
    return (await this.findAll()).filter((category) => category.status === 'ACTIVE');
  }

  public async findById(id: string): Promise<FakeCategory> {
    const found = this.categories.find((category) => category.id === id);

    if (found === undefined) {
      throw notFound('Expense category', id);
    }

    return found;
  }

  public async requireActive(id: string): Promise<FakeCategory> {
    const category = await this.findById(id);

    if (category.status !== 'ACTIVE') {
      throw validationFailed('Only an active category can be used for a new expense.', {
        field: 'categoryId',
      });
    }

    return category;
  }

  public async findByNormalizedName(name: string): Promise<FakeCategory | null> {
    return (
      this.categories.find((category) => category.normalizedName === normalizeCategoryName(name)) ??
      null
    );
  }

  public async create(name: string, actorAdminId: string): Promise<FakeCategory> {
    return this.createWithinTransaction(null, name, actorAdminId);
  }

  public async createWithinTransaction(
    _tx: unknown,
    name: string,
    actorAdminId: string,
  ): Promise<FakeCategory> {
    const displayName = name.trim();

    if (displayName === '') {
      throw validationFailed('A category name is required.', { field: 'name' });
    }

    const normalizedName = normalizeCategoryName(displayName);

    if (this.categories.some((category) => category.normalizedName === normalizedName)) {
      throw conflict('A category with this name already exists.', { field: 'name' });
    }

    this.created.push({ name: displayName, actorAdminId });

    const category = categoryFixture({
      id: `0000e000-0000-4000-8000-${String(this.categories.length + 1).padStart(12, '0')}`,
      name: displayName,
      isSystem: false,
    });

    this.categories.push(category);

    return category;
  }

  public async update(
    id: string,
    changes: { readonly name?: string; readonly status?: 'ACTIVE' | 'INACTIVE' },
    actorAdminId: string,
  ): Promise<FakeCategory> {
    return this.updateWithinTransaction(null, id, changes, actorAdminId);
  }

  public async updateWithinTransaction(
    _tx: unknown,
    id: string,
    changes: { readonly name?: string; readonly status?: 'ACTIVE' | 'INACTIVE' },
    actorAdminId: string,
  ): Promise<FakeCategory> {
    const current = await this.findById(id);

    this.updated.push({ id, changes, actorAdminId });

    if (changes.name !== undefined) {
      const displayName = changes.name.trim();

      if (displayName === '') {
        throw validationFailed('A category name is required.', { field: 'name' });
      }

      const normalizedName = normalizeCategoryName(displayName);

      if (
        normalizedName !== current.normalizedName &&
        this.categories.some((category) => category.normalizedName === normalizedName)
      ) {
        throw conflict('A category with this name already exists.', { field: 'name' });
      }

      current.name = displayName;
      current.normalizedName = normalizedName;
    }

    if (changes.status !== undefined) {
      current.status = changes.status;
    }

    current.updatedAt = new Date('2026-09-10T06:00:00.000Z');

    return current;
  }
}

/**
 * The idempotency double.
 *
 * It reproduces the two rules the HTTP layer depends on: an identical key with an identical
 * payload replays the stored response, and the same key with a different payload is a
 * conflict. The concurrency serialization and the 30-day expiry are proven by the database
 * suite, not here.
 */
export class FakeIdempotency {
  public readonly calls: { readonly endpoint: string; readonly key: string }[] = [];

  private readonly stored = new Map<
    string,
    { readonly hash: string; readonly status: number; readonly body: unknown }
  >();

  public async runOnce<TBody>(
    input: {
      readonly adminUserId: string;
      readonly endpoint: string;
      readonly idempotencyKey: string;
      readonly request: unknown;
    },
    command: (tx: unknown) => Promise<{ responseStatus: number; responseBody: unknown }>,
  ): Promise<{
    readonly replayed: boolean;
    readonly responseStatus: number;
    readonly responseBody: TBody;
  }> {
    const hash = stableStringify(input.request);
    const key = `${input.adminUserId}|${input.endpoint}|${input.idempotencyKey}`;

    this.calls.push({ endpoint: input.endpoint, key: input.idempotencyKey });

    const existing = this.stored.get(key);

    if (existing !== undefined) {
      if (existing.hash !== hash) {
        throw conflict('This idempotency key was already used with a different request.', {
          field: 'idempotencyKey',
        });
      }

      return {
        replayed: true,
        responseStatus: existing.status,
        responseBody: existing.body as TBody,
      };
    }

    const response = await command(null);
    this.stored.set(key, {
      hash,
      status: response.responseStatus,
      body: response.responseBody,
    });

    return {
      replayed: false,
      responseStatus: response.responseStatus,
      responseBody: response.responseBody as TBody,
    };
  }
}

/** Deterministic ordering: the requested field, then `referenceId` so equal values never tie. */
function compareRows(
  left: FakeTransactionRow,
  right: FakeTransactionRow,
  field: TransactionSortField,
  direction: TransactionSortDirection,
): number {
  const sign = direction === 'asc' ? 1 : -1;
  const primary = compareValues(sortValue(left, field), sortValue(right, field));

  if (primary !== 0) {
    return primary * sign;
  }

  return left.referenceId.localeCompare(right.referenceId);
}

function sortValue(row: FakeTransactionRow, field: TransactionSortField): string | number {
  switch (field) {
    case 'amount':
      return Number(row.amountPaise);
    case 'referenceId':
      return row.referenceId;
    case 'createdAt':
      return row.createdAt.getTime();
    default:
      return row.businessDate.getTime();
  }
}

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

/** A key-order-independent hash of the honoured request, as the real runner does. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/**
 * A session the fake `SessionService` resolves, with a CSRF hash the real service can verify.
 *
 * The `csrfTokenHash` is a real hash of the token the suite sends, so the CSRF guard is
 * genuinely exercised rather than stubbed out — a suite that disabled it would prove nothing
 * about the guard.
 */
export function fakeSession(options: {
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly adminId?: string;
  readonly identifier?: string;
  readonly displayName?: string;
}): AuthenticatedSession {
  return {
    sessionId: options.sessionId,
    admin: {
      id: options.adminId ?? TEST_ACTOR_ADMIN_ID,
      identifier: options.identifier ?? 'admin',
      displayName: options.displayName ?? TEST_ACTOR_DISPLAY_NAME,
    },
    csrfTokenHash: hashToken(options.csrfToken),
    context: {
      issuedAt: '2026-09-10T04:00:00.000Z',
      expiresAt: '2026-09-17T04:00:00.000Z',
    },
  };
}

/**
 * A transaction row with the defaults every fixture shares.
 *
 * `occurredAt` is derived from the business date minus 5h30m, which is the start of that day in
 * `Asia/Kolkata` expressed as UTC. Deriving it here rather than hard-coding a second date
 * means a fixture can only be internally consistent: an entry for 25 Sep is recorded inside
 * 25 Sep, which is the rule the create paths enforce.
 */
export function transactionFixture(
  overrides: Partial<FakeTransactionRow> & { id: string },
): FakeTransactionRow {
  const businessDate = overrides.businessDate ?? parseBusinessDate('2026-09-05');

  return {
    referenceId: 'HY-INC-000001',
    transactionType: 'INCOME',
    incomeType: 'OFFERING',
    amountPaise: 100_00n,
    paymentMethod: 'CASH',
    description: 'Fixture',
    notes: null,
    memberId: null,
    contributionPeriodId: null,
    categoryId: null,
    status: 'ACTIVE',
    voidReason: null,
    voidedAt: null,
    createdByAdminId: TEST_ACTOR_ADMIN_ID,
    revision: 1,
    createdAt: new Date('2026-09-10T04:00:00.000Z'),
    updatedAt: new Date('2026-09-10T04:00:00.000Z'),
    documentCount: 0,
    ...overrides,
    businessDate,
    occurredAt: new Date(businessDate.getTime() - 5.5 * 3_600_000),
  };
}

/** A category row with the defaults every fixture shares, normalized as the schema requires. */
export function categoryFixture(overrides: Partial<FakeCategory> & { id: string }): FakeCategory {
  const name = overrides.name ?? 'Fixture category';

  return {
    name,
    normalizedName: normalizeCategoryName(name),
    status: 'ACTIVE',
    isSystem: false,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}
