import { Injectable } from '@nestjs/common';
import {
  ANONYMOUS_DONATION_DESCRIPTION,
  isAnonymousIncomeType,
  type TransactionSummary,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import { IdempotentCommandRunner, type IdempotencyKey } from '../common/http/idempotency';
import { startOfBusinessDay } from '../common/time/business-date';
import { ContributionPeriodRepository } from '../database/contributions/contribution-period.repository';
import { MemberRepository } from '../database/members/member.repository';
import { AppSettingRepository } from '../database/settings/app-setting.repository';
import { defaultContributionPaise } from '../database/settings/app-setting.validation';
import { TransactionRepository } from '../database/transactions/transaction.repository';
import { toTransactionSummary } from '../transactions/transaction-mapper';
import {
  parseAmountPaise,
  parseBusinessDateValue,
  type TransactionActor,
} from '../transactions/transactions.service';
import type { CreateIncomeDto } from './dto/income.dto';

const INCOME_ENDPOINT = 'POST /api/v1/income';

/**
 * Income commands.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-INCOME-001` to `REQ-INCOME-006` and
 * `REQ-DOC-010` to `REQ-DOC-014`; transport from `docs/06-API-SPEC.md`. Correction, void,
 * audit, and receipts are **not** implemented here: they are shared transaction behaviour and
 * live in `TransactionsService`, which is what guarantees a void behaves identically for
 * income and expenses. Income *reads* are likewise shared — `docs/06-API-SPEC.md` defines no
 * `GET /api/v1/income`; the browser lists income through `GET /api/v1/transactions` with the
 * `type=INCOME` filter, so there is no second read path that could disagree with the ledger.
 *
 * The three rules this service owns, and refuses to delegate:
 *
 * 1. **The member and period rules follow the income type.** A `Member Contribution` needs
 *    both a member and a member-month; an `Offering` or `Donation` may name a member and must
 *    not carry a period; an `Anonymous Donation` may carry neither.
 * 2. **An anonymous donation cannot record an identity, by any route.** The member is
 *    refused, the note is refused, and the description is replaced with the server-owned
 *    neutral value instead of being accepted. The stored row therefore has no identity to
 *    leak, and the read path independently refuses to project one.
 * 3. **Contribution status is derived, never stored or accepted.** The member-month is opened
 *    against the ledger in the same transaction as the payment, so its received total and
 *    therefore its `PAID` / `PARTIALLY PAID` / `NOT PAID` status are re-read from active
 *    transactions by the contribution-period reads, and a client cannot assert its own status
 *    (`REQ-CONTRIB-003`).
 */
@Injectable()
export class IncomeService {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly members: MemberRepository,
    private readonly periods: ContributionPeriodRepository,
    private readonly settings: AppSettingRepository,
    private readonly idempotency: IdempotentCommandRunner,
  ) {}

  /**
   * Records an income transaction, at most once per idempotency key.
   *
   * The financial write, its audit event, its `HY-INC-` reference, the member-month it belongs
   * to, and the stored idempotency response all commit in one transaction. A retry therefore
   * either finds the original record or creates the first one — never a second contribution,
   * which is the specific duplicate this requirement exists to prevent in a church ledger.
   */
  public async create(
    input: CreateIncomeDto,
    actor: TransactionActor,
    idempotency: IdempotencyKey,
  ): Promise<TransactionSummary> {
    const rules = this.resolveIncomeRules(input);
    const businessDate = parseBusinessDateValue(input.businessDate);
    const amountPaise = parseAmountPaise(input.amount);

    // Confirmed before the write so an unknown member is the documented 404 rather than a
    // foreign-key failure the Admin would read as a server fault. The database trigger also
    // verifies the period belongs to this member, so the link is checked at both layers.
    if (rules.memberId !== undefined) {
      await this.members.findById(rules.memberId);
    }

    // `occurred_at` is the recorded instant and `business_date` is the Asia/Kolkata
    // accounting date. Deriving the instant from the start of that business day keeps the two
    // consistent: an entry for 25 Sep is recorded inside 25 Sep, never shifted a day by a UTC
    // or server-timezone conversion.
    const occurredAt = startOfBusinessDay(businessDate);

    const result = await this.idempotency.run<TransactionSummary>({
      adminUserId: actor.adminUserId,
      endpoint: INCOME_ENDPOINT,
      idempotencyKey: idempotency.key,
      // The validated body, reduced to what was actually honoured. Hashing exactly this means
      // a retry of the same form produces the same hash, while a genuinely different request
      // is caught as key reuse with a different payload.
      request: {
        incomeType: input.incomeType,
        amount: input.amount.trim(),
        paymentMethod: input.paymentMethod,
        businessDate: input.businessDate.trim(),
        ...(rules.memberId === undefined ? {} : { memberId: rules.memberId }),
        ...(rules.periodRef === undefined ? {} : { contributionPeriod: rules.periodRef }),
        ...(rules.description === undefined ? {} : { description: rules.description }),
        ...(rules.notes === undefined ? {} : { notes: rules.notes }),
      },
      run: async (tx) => {
        let contributionPeriodId: string | null = null;

        if (rules.periodRef !== undefined && rules.memberId !== undefined) {
          // The period is opened in the same transaction as the contribution, so a rolled-back
          // payment cannot leave behind a member-month nobody asked for.
          const period = await this.periods.findOrCreateWithinTransaction(
            tx,
            {
              memberId: rules.memberId,
              year: rules.periodRef.year,
              month: rules.periodRef.month,
              expectedPaise: await this.defaultMonthlyContributionPaise(),
            },
            actor.adminUserId,
          );

          contributionPeriodId = period.id;
        }

        const created = await this.transactions.createWithinTransaction(
          tx,
          {
            transactionType: 'INCOME',
            incomeType: input.incomeType,
            amountPaise,
            paymentMethod: input.paymentMethod,
            businessDate,
            occurredAt,
            description: rules.description ?? null,
            notes: rules.notes ?? null,
            memberId: rules.memberId ?? null,
            contributionPeriodId,
          },
          { actorAdminId: actor.adminUserId, requestId: actor.requestId },
        );

        return { status: 201, body: toTransactionSummary(created) };
      },
    });

    return result.body;
  }

  /**
   * Applies the income-type rules to a validated create body.
   *
   * This is the single place the member/period matrix is decided, and it runs before anything
   * is written, so an invalid combination costs no database round trip and cannot leave a
   * partial record behind.
   */
  private resolveIncomeRules(input: CreateIncomeDto): {
    readonly memberId?: string;
    readonly periodRef?: { readonly year: number; readonly month: number };
    readonly description?: string;
    readonly notes?: string;
  } {
    if (isAnonymousIncomeType(input.incomeType)) {
      // `REQ-INCOME-005` and `REQ-INCOME-006`. Every identity-bearing input is either refused
      // or replaced. The description is replaced rather than refused so one form can post the
      // same shape for every income type; the note is refused because dropping it silently
      // would leave the Admin believing a name had been saved.
      if (input.memberId !== undefined) {
        throw validationFailed('An anonymous donation cannot identify a member.', {
          field: 'memberId',
        });
      }

      if (input.contributionPeriod !== undefined) {
        throw validationFailed('An anonymous donation cannot belong to a contribution period.', {
          field: 'contributionPeriod',
        });
      }

      if (input.notes !== undefined && input.notes !== '') {
        throw validationFailed('An anonymous donation cannot carry a note.', { field: 'notes' });
      }

      return { description: ANONYMOUS_DONATION_DESCRIPTION };
    }

    if (input.incomeType === 'MEMBER_CONTRIBUTION') {
      // `REQ-INCOME-003`. The period is checked after the member so the error names the field
      // the Admin still has to supply rather than reporting both at once.
      if (input.memberId === undefined) {
        throw validationFailed('A member contribution requires a member.', { field: 'memberId' });
      }

      if (input.contributionPeriod === undefined) {
        throw validationFailed('A member contribution requires a contribution month.', {
          field: 'contributionPeriod',
        });
      }

      return {
        memberId: input.memberId,
        periodRef: {
          year: input.contributionPeriod.year,
          month: input.contributionPeriod.month,
        },
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      };
    }

    // Offering and Donation: a member is optional and a period is never allowed, because
    // only a member contribution is measured against a monthly expectation.
    if (input.contributionPeriod !== undefined) {
      throw validationFailed(
        'Only a member contribution belongs to a contribution month. Record it as a member contribution instead.',
        { field: 'contributionPeriod' },
      );
    }

    return {
      ...(input.memberId === undefined ? {} : { memberId: input.memberId }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    };
  }

  /**
   * The configured default monthly contribution, in paise.
   *
   * Read from `app_setting` rather than hard-coded, so Phase 10 can change the default without
   * touching financial logic. The stored value is already a paise count, so it is read with
   * `defaultContributionPaise` and never re-parsed as rupees — treating `"50000"` as rupees
   * would bill a member ₹50,000 instead of ₹500.
   *
   * A missing row is a server fault, not a validation problem: silently falling back to a
   * baked-in amount would let two deployments disagree about what a member owes. `findOne`
   * raises the documented not-found error, which the global filter reports without leaking
   * the setting name.
   */
  private async defaultMonthlyContributionPaise(): Promise<bigint> {
    const setting = await this.settings.findOne('DEFAULT_MONTHLY_CONTRIBUTION_PAISE');

    return defaultContributionPaise(setting.value);
  }
}
