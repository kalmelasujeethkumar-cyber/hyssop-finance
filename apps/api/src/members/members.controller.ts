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
  Put,
  Query,
  Version,
} from '@nestjs/common';
import {
  success,
  type ApiListEnvelope,
  type ContributionPeriodSummary,
  type ContributionPeriodView,
  type MemberDetail,
  type MemberSummary,
  type MemberTransactionView,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import { CurrentSession } from '../auth/auth.decorators';
import type { AuthenticatedSession } from '../auth/session.service';
import {
  ContributionPeriodFilterDto,
  ContributionPeriodPathDto,
  CreateMemberDto,
  MemberContributionsQueryDto,
  MemberIdParamDto,
  MemberListQueryDto,
  SetContributionPeriodDto,
  UpdateMemberDto,
} from './dto/member.dto';
import { MembersService } from './members.service';

/** `If-Match` carries the member `revision` the client read, as the API spec allows. */
const IF_MATCH_HEADER = 'if-match';

/**
 * The member routes of `docs/06-API-SPEC.md`.
 *
 * Every route here is protected. There is no `@Public()` on this controller, and the
 * global `SessionGuard` is opt-out rather than opt-in, so a new member route added in a
 * later phase cannot become reachable without a session by accident.
 *
 * The controller only binds HTTP to the service: validation, the derived contribution
 * projection, and audit actor identity all come from below, and no route builds its own
 * query.
 */
@Controller('members')
export class MembersController {
  public constructor(private readonly members: MembersService) {}

  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async listMembers(
    @Query() query: MemberListQueryDto,
  ): Promise<ApiListEnvelope<MemberSummary>> {
    return this.members.list({
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.page === undefined ? {} : { page: query.page }),
      ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.direction === undefined ? {} : { direction: query.direction }),
    });
  }

  @Post()
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  public async createMember(
    @Body() body: CreateMemberDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ data: MemberSummary }> {
    return success(await this.members.create(body, session.admin.id));
  }

  @Get(':id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async getMember(
    @Param() params: MemberIdParamDto,
    @Query() query: MemberContributionsQueryDto,
  ): Promise<{ data: MemberDetail }> {
    const detail =
      query.year === undefined
        ? await this.members.detail(params.id)
        : await this.members.detail(params.id, query.year);

    return success(detail);
  }

  /**
   * Audited edit with an optimistic lock.
   *
   * The `HY-MEM-` reference is immutable and is not accepted in the body, so it cannot be
   * changed by a client even if a future UI offered the control.
   */
  @Patch(':id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async updateMember(
    @Param() params: MemberIdParamDto,
    @Body() body: UpdateMemberDto,
    @Headers(IF_MATCH_HEADER) ifMatch: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ data: MemberSummary }> {
    return success(
      await this.members.update(params.id, body, readExpectedRevision(ifMatch), session.admin.id),
    );
  }

  @Get(':id/contributions')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async memberContributions(
    @Param() params: MemberIdParamDto,
    @Query() query: MemberContributionsQueryDto,
  ): Promise<{ data: readonly ContributionPeriodView[] }> {
    const periods =
      query.year === undefined
        ? await this.members.contributionsForMember(params.id)
        : await this.members.contributionsForMember(params.id, query.year);

    return success(periods);
  }

  /**
   * The member's own contribution transactions, newest first.
   *
   * A read-only projection. Voided rows are included and carry their status, so the Admin
   * can see that a payment was voided; they are excluded from every derived total by the
   * contribution period read above. Writing a transaction is Phase 05 work, so this route
   * intentionally offers no create, edit, or void.
   */
  @Get(':id/transactions')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async memberTransactions(
    @Param() params: MemberIdParamDto,
  ): Promise<{ data: readonly MemberTransactionView[] }> {
    return success(await this.members.transactionsForMember(params.id));
  }
}

/**
 * The contribution-period routes.
 *
 * `summary` is declared before the parameterized `:memberId/:year/:month` route so the
 * static path wins during routing, as `docs/06-API-SPEC.md` requires.
 */
@Controller('contribution-periods')
export class ContributionPeriodsController {
  public constructor(private readonly members: MembersService) {}

  @Get('summary')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async summary(
    @Query() query: ContributionPeriodFilterDto,
  ): Promise<{ data: ContributionPeriodSummary }> {
    if (query.year === undefined || query.month === undefined) {
      throw validationFailed('A summary requires both a year and a month.', {
        field: query.year === undefined ? 'year' : 'month',
      });
    }

    return success(await this.members.contributionSummary(query.year, query.month));
  }

  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async listPeriods(
    @Query() query: ContributionPeriodFilterDto,
  ): Promise<{ data: readonly ContributionPeriodView[] }> {
    return success(
      await this.members.listContributionPeriods({
        ...(query.memberId === undefined ? {} : { memberId: query.memberId }),
        ...(query.year === undefined ? {} : { year: query.year }),
        ...(query.month === undefined ? {} : { month: query.month }),
        // The DTO already narrowed this to the `CONTRIBUTION_STATUSES` union, so the
        // value is forwarded without a cast that could hide a widening of the DTO.
        ...(query.status === undefined ? {} : { status: query.status }),
      }),
    );
  }

  /**
   * Sets the expected amount for one member-month.
   *
   * Idempotent: the same expected amount returns the current derived state without
   * writing, and a different amount updates it. Received, remaining, and status are never
   * accepted from the client, so this endpoint cannot be used to mark a period paid.
   */
  @Put(':memberId/:year/:month')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async setPeriod(
    @Param() path: ContributionPeriodPathDto,
    @Body() body: SetContributionPeriodDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ data: ContributionPeriodView }> {
    return success(
      await this.members.setContributionPeriod({
        memberId: path.memberId,
        year: path.year,
        month: path.month,
        // Spread rather than assigning `undefined`: the service distinguishes "no amount
        // supplied, use the configured default" from "an amount was supplied", and an
        // explicit `undefined` property must not collapse into the first case.
        ...(body.expectedPaise === undefined ? {} : { expectedPaise: body.expectedPaise }),
        actorAdminId: session.admin.id,
      }),
    );
  }
}

/**
 * Reads the optimistic-lock revision from `If-Match`.
 *
 * The value may be quoted, as the HTTP conditional-request syntax allows, or bare. A
 * missing or non-numeric value is rejected rather than defaulted, because silently
 * treating it as revision 1 would let a client overwrite an edit it never read.
 */
function readExpectedRevision(ifMatch: string | undefined): number {
  if (ifMatch === undefined) {
    throw validationFailed('An If-Match revision is required to update a member.', {
      field: 'If-Match',
    });
  }

  const raw = ifMatch.trim().replace(/^W\//i, '').replace(/^"|"$/g, '').trim();

  if (!/^\d+$/.test(raw)) {
    throw validationFailed('The If-Match value must be a member revision number.', {
      field: 'If-Match',
    });
  }

  const revision = Number.parseInt(raw, 10);

  if (revision < 1) {
    throw validationFailed('The If-Match value must be a member revision number.', {
      field: 'If-Match',
    });
  }

  return revision;
}
