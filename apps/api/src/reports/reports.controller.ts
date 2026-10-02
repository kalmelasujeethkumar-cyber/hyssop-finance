import { Controller, Get, HttpCode, HttpStatus, Param, Query, Res, Version } from '@nestjs/common';
import type { Response } from 'express';
import {
  CSV_CONTENT_DISPOSITION,
  CSV_CONTENT_TYPE,
  REPORT_TITLES,
  success,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  type AuditReportAction,
  type AuditReport,
  type BreakdownReport,
  type CompleteTransactionReport,
  type DashboardPeriodPreset,
  type DocumentReport,
  type FinancialSummaryReport,
  type GlobalSearchResponse,
  type MemberContributionReport,
  type PaymentMethodReport,
  type ReportId,
  type SearchType,
  type TransactionListReport,
  type TransactionStatus,
  type TransactionType,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import {
  currentBusinessDate,
  resolvePeriod,
  type ResolvedPeriod,
} from '../dashboard/period.resolver';
import {
  AuditReportQueryDto,
  ReportIdParamDto,
  ReportQueryDto,
  SearchQueryDto,
  TransactionReportQueryDto,
} from './dto/report.dto';
import { csvFilename } from './csv';
import { reportToCsv } from './report-csv';
import { ReportsService, type ReportPage } from './reports.service';

/**
 * The report routes of `docs/06-API-SPEC.md` "Dashboard and reports".
 *
 * Protected by the global `SessionGuard`: there is no `@Public()` here, so no report is reachable
 * without a session.
 *
 * The controller binds HTTP and nothing else. Period boundaries are decided by the canonical
 * `resolvePeriod` rather than here, so a report cannot grow its own opinion about what "this
 * month" means, and the exact-string money arrives from the service already formatted.
 *
 * Every period-bounded report delegates to the same service projection the dashboard's canonical
 * layer uses, so a report total and the dashboard card for the same period are the same number.
 */
@Controller('reports')
export class ReportsController {
  public constructor(private readonly reports: ReportsService) {}

  @Get('financial-summary')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async financialSummary(
    @Query() query: ReportQueryDto,
  ): Promise<{ data: FinancialSummaryReport }> {
    return success(await this.reports.financialSummary(periodOf(query)));
  }

  @Get('income')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async income(@Query() query: ReportQueryDto): Promise<{ data: BreakdownReport }> {
    return success(await this.reports.income(periodOf(query)));
  }

  @Get('expenses')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async expenses(@Query() query: ReportQueryDto): Promise<{ data: BreakdownReport }> {
    return success(await this.reports.expenses(periodOf(query)));
  }

  @Get('expense-categories')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async expenseCategories(
    @Query() query: ReportQueryDto,
  ): Promise<{ data: BreakdownReport }> {
    return success(await this.reports.expenseCategories(periodOf(query)));
  }

  @Get('member-contributions')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async memberContributions(
    @Query() query: ReportQueryDto,
  ): Promise<{ data: MemberContributionReport }> {
    return success(await this.reports.memberContributions(periodOf(query)));
  }

  @Get('offerings')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async offerings(@Query() query: ReportQueryDto): Promise<{ data: TransactionListReport }> {
    return success(await this.reports.offerings(periodOf(query)));
  }

  @Get('donations')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async donations(@Query() query: ReportQueryDto): Promise<{ data: TransactionListReport }> {
    return success(await this.reports.donations(periodOf(query)));
  }

  @Get('payment-methods')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async paymentMethods(
    @Query() query: ReportQueryDto,
  ): Promise<{ data: PaymentMethodReport }> {
    return success(await this.reports.paymentMethods(periodOf(query)));
  }

  @Get('documents')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async documents(@Query() query: ReportQueryDto): Promise<{ data: DocumentReport }> {
    return success(await this.reports.documents(periodOf(query)));
  }

  /**
   * The Audit report.
   *
   * A history read, so its window is an explicit `from`/`to` of ISO instants rather than a period
   * preset, and it retains voided-era events by design.
   */
  @Get('audit')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async audit(@Query() query: AuditReportQueryDto): Promise<{ data: AuditReport }> {
    const report = await this.reports.audit({
      ...(query.from === undefined ? {} : { from: instantOf(query.from, 'from') }),
      ...(query.to === undefined ? {} : { to: instantOf(query.to, 'to') }),
      ...(query.action === undefined ? {} : { action: query.action as AuditReportAction }),
      page: pageOf(query),
    });

    return success(report);
  }

  /** The Complete Transaction report — the history report, so voided rows are retained. */
  @Get('transactions')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async transactions(
    @Query() query: TransactionReportQueryDto,
  ): Promise<{ data: CompleteTransactionReport }> {
    return success(
      await this.reports.transactions(
        periodOf(query),
        {
          ...(query.type === undefined ? {} : { type: query.type as TransactionType }),
          ...(query.status === undefined ? {} : { status: query.status as TransactionStatus }),
        },
        { page: query.page ?? 1, pageSize: query.pageSize ?? TRANSACTION_PAGE_SIZE_DEFAULT },
      ),
    );
  }

  /**
   * `GET /api/v1/reports/:reportId/export.csv`.
   *
   * Declared after every static report route so a literal segment always wins during routing, and
   * only this one method carries `.csv` in its path.
   *
   * The report is produced by exactly the same service projection the JSON route returns, then
   * rendered by the CSV writer. That is what makes `docs/06-API-SPEC.md`'s "the same projections
   * are consumed by CSV export and print" true by construction rather than by discipline.
   *
   * `reportId` is already constrained to the eleven documented reports by the DTO, so the
   * dispatch below cannot be reached with an arbitrary string.
   */
  @Get(':reportId/export.csv')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async exportCsv(
    @Param() params: ReportIdParamDto,
    @Query() query: ReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const reportId = params.reportId as ReportId;
    const csv = reportToCsv(reportId, await this.reportForExport(reportId, query));

    response.setHeader('Content-Type', CSV_CONTENT_TYPE);
    response.setHeader(
      'Content-Disposition',
      `${CSV_CONTENT_DISPOSITION}; filename="${csvFilename(reportId)}"`,
    );
    response.send(csv);
  }

  /** Produces the same projection the JSON route returns, for the export writer to render. */
  private async reportForExport(reportId: ReportId, query: ReportQueryDto): Promise<unknown> {
    const period = periodOf(query);

    switch (reportId) {
      case 'financial-summary':
        return this.reports.financialSummary(period);
      case 'income':
        return this.reports.income(period);
      case 'expenses':
        return this.reports.expenses(period);
      case 'expense-categories':
        return this.reports.expenseCategories(period);
      case 'member-contributions':
        return this.reports.memberContributions(period);
      case 'offerings':
        return this.reports.offerings(period);
      case 'donations':
        return this.reports.donations(period);
      case 'payment-methods':
        return this.reports.paymentMethods(period);
      case 'documents':
        return this.reports.documents(period);
      case 'audit':
        // The Audit report is a history read over `from`/`to` instants, not a period. The export
        // route's query is a period query, so it is resolved to an explicit instant window here —
        // the whole period, as instants — rather than being answered with a period-shaped report.
        return this.reports.audit({
          from: instantAtStartOfDay(period.from),
          to: instantAtEndOfDay(period.to),
          page: { page: 1, pageSize: 100 },
        });
      case 'transactions':
        return this.reports.transactions(period, {}, { page: 1, pageSize: 100 });
      default: {
        const exhaustive: never = reportId;

        throw validationFailed(`Unsupported report: ${String(exhaustive)}`, { field: 'reportId' });
      }
    }
  }
}

/**
 * `GET /api/v1/search` — global search.
 *
 * Its own controller because `docs/06-API-SPEC.md` documents it as its own top-level route rather
 * than as a report. It is protected by the same global `SessionGuard`.
 */
@Controller('search')
export class SearchController {
  public constructor(private readonly reports: ReportsService) {}

  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async search(@Query() query: SearchQueryDto): Promise<{ data: GlobalSearchResponse }> {
    return success(
      await this.reports.search({
        term: query.q,
        type: (query.type ?? 'all') as SearchType,
        page: {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? TRANSACTION_PAGE_SIZE_DEFAULT,
        },
      }),
    );
  }
}

/** The documented title for a report, so print headers and the picker read the same text. */
export { REPORT_TITLES };

/**
 * Resolves the period from a report query using the canonical resolver.
 *
 * `currentBusinessDate()` reduces the instant to the Asia/Kolkata calendar day first, so `thisMonth`
 * resolves from the IST month rather than the UTC one — the same order the dashboard uses.
 */
function periodOf(query: ReportQueryDto): ResolvedPeriod {
  return resolvePeriod(
    {
      ...(query.period === undefined ? {} : { preset: query.period as DashboardPeriodPreset }),
      ...(query.from === undefined && query.to === undefined
        ? {}
        : { custom: { from: query.from ?? '', to: query.to ?? '' } }),
    },
    currentBusinessDate(),
  );
}

/** Parses an ISO instant for an audit window, reporting a malformed value as a 400. */
function instantOf(raw: string, field: 'from' | 'to'): Date {
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw validationFailed(
      field === 'from'
        ? 'Enter a start instant as YYYY-MM-DDTHH:mm:ssZ, such as 2026-09-01T00:00:00Z.'
        : 'Enter an end instant as YYYY-MM-DDTHH:mm:ssZ, such as 2026-09-30T23:59:59Z.',
      { field },
    );
  }

  return parsed;
}

/** The first instant of an Asia/Kolkata business day, used to widen a period for a history export. */
function instantAtStartOfDay(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  return new Date(Date.UTC(year, month, day, -5, -30, 0));
}

/** The last instant of an Asia/Kolkata business day. */
function instantAtEndOfDay(date: Date): Date {
  return new Date(instantAtStartOfDay(date).getTime() + 86_400_000 - 1);
}

function pageOf(query: AuditReportQueryDto): ReportPage {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? TRANSACTION_PAGE_SIZE_DEFAULT,
  };
}
