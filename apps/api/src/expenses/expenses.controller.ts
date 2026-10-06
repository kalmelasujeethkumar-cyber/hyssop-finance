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
  type ExpenseCategoryView,
  type ExpenseReasonView,
  type ExpenseSummary,
} from '@hyssop/contracts';
import { CurrentRequestId, CurrentSession } from '../auth/auth.decorators';
import type { AuthenticatedSession } from '../auth/session.service';
import { IDEMPOTENCY_KEY_HEADER, readIdempotencyKey } from '../common/http/idempotency';
import { listRequestFromSharedQuery } from '../transactions/transactions.controller';
import type { TransactionActor } from '../transactions/transactions.service';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  CreateExpenseReasonDto,
  ExpenseCategoryIdParamDto,
  ExpenseListQueryDto,
  ExpenseReasonIdParamDto,
  ExpenseReasonListQueryDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseReasonDto,
} from './dto/expense.dto';
import { ExpensesService } from './expenses.service';

/**
 * The expense routes of `docs/06-API-SPEC.md`.
 *
 * Every route is protected by the global `SessionGuard`; there is no `@Public()` here, so a
 * financial record cannot become reachable without a session by accident.
 *
 * Detail, correction, void, audit, and receipts are deliberately **absent**. They are shared
 * transaction routes under `/transactions`, implemented once in `TransactionsController`, and
 * duplicating them here is exactly what the architecture's "one canonical representation"
 * rule exists to prevent: a second void endpoint would be a second void implementation that
 * could drift.
 *
 * The controller only binds HTTP to the service. Validation, exact money parsing, the active
 * category rule, and audit actor identity all come from below.
 */
@Controller('expenses')
export class ExpensesController {
  public constructor(private readonly expenses: ExpensesService) {}

  /**
   * Records an expense transaction.
   *
   * An `Idempotency-Key` is required. Without one, a double submit or a retry after a timeout
   * would record the same payment twice and overstate the church's expenses, which is the same
   * failure mode the income create route exists to prevent. A missing key is rejected rather
   * than defaulted.
   */
  @Post()
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  public async createExpense(
    @Body() body: CreateExpenseDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: ExpenseSummary }> {
    return success(
      await this.expenses.create(body, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }

  /**
   * The expense list.
   *
   * `ExpenseListQueryDto` has no `type` and no `incomeType`, so the global pipe's
   * `forbidNonWhitelisted` setting rejects a request that tries to widen this into an income
   * query, and the service independently forces `type=EXPENSE`.
   */
  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async listExpenses(
    @Query() query: ExpenseListQueryDto,
  ): Promise<ApiListEnvelope<ExpenseSummary>> {
    return this.expenses.list(listRequestFromSharedQuery(query));
  }

  /**
   * The category list, only active.
   *
   * `docs/05-DATABASE-SPEC.md`: "The API exposes active categories for new entries and preserves
   * inactive categories on historical transactions". Declared before the `:id` routes so
   * `GET /expenses/categories` is not matched as a category identifier. The server refuses an
   * inactive category regardless, but returning inactive rows in the form dropdown would be a
   * dead control and a violation of the state-honesty rule.
   */
  @Get('categories')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async listCategories(): Promise<{ data: readonly ExpenseCategoryView[] }> {
    return success(await this.expenses.listCategories());
  }

  /**
   * Adds a custom expense category.
   *
   * `isSystem` is not accepted, because the initial set is a documented product set that only
   * the seed marks. The write is idempotent so a double submit cannot create two categories
   * that differ only by trailing whitespace.
   */
  @Post('categories')
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  public async createCategory(
    @Body() body: CreateExpenseCategoryDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: ExpenseCategoryView }> {
    return success(
      await this.expenses.createCategory(body, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }

  /**
   * Renames a category or activates/deactivates it.
   *
   * There is no delete route, by design: `docs/05-DATABASE-SPEC.md` says a category is
   * deactivated so historical expenses keep the label they were recorded with. The write is
   * idempotent because an identical retry replays the original response instead of recording a
   * second audit event describing a change that was already made.
   */
  @Patch('categories/:id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async updateCategory(
    @Param() params: ExpenseCategoryIdParamDto,
    @Body() body: UpdateExpenseCategoryDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: ExpenseCategoryView }> {
    return success(
      await this.expenses.updateCategory(params.id, body, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }

  /**
   * The active reasons of one category, for the Record Expense form.
   *
   * `categoryId` is required, because a reason belongs to a category and returning every reason
   * for every category would leave the browser guessing which subset applies to the category the
   * Admin selected. Only active rows are returned, exactly as the category list is: a deactivated
   * reason in the dropdown is a dead control the server would refuse.
   */
  @Get('reasons')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async listReasons(
    @Query() query: ExpenseReasonListQueryDto,
  ): Promise<{ data: readonly ExpenseReasonView[] }> {
    return success(await this.expenses.listReasons(query.categoryId));
  }

  /**
   * Adds a custom reason under a category.
   *
   * `isSystem` is not accepted, for the same reason as on a category: the predefined
   * per-category reasons are a documented product set that only the seed marks. The write is
   * idempotent so a double submit cannot create two reasons that differ only by trailing
   * whitespace.
   */
  @Post('reasons')
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  public async createReason(
    @Body() body: CreateExpenseReasonDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: ExpenseReasonView }> {
    return success(
      await this.expenses.createReason(body, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }

  /**
   * Renames a reason or activates/deactivates it.
   *
   * There is no delete route and no way to move a reason between categories, by design: the row
   * survives so historical expenses keep the label they were recorded with, and moving it would
   * strand those expenses under a reason their category no longer owns.
   */
  @Patch('reasons/:id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async updateReason(
    @Param() params: ExpenseReasonIdParamDto,
    @Body() body: UpdateExpenseReasonDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: ExpenseReasonView }> {
    return success(
      await this.expenses.updateReason(params.id, body, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }
}

/** The authenticated Admin and the request correlation ID, for audit attribution. */
function actorOf(session: AuthenticatedSession, requestId: string | null): TransactionActor {
  return { adminUserId: session.admin.id, requestId };
}
