import {
  REPORT_CSV_COLUMNS,
  type CompleteTransactionReport,
  type ReportDocumentLink,
  type TransactionListReport,
} from '@hyssop/contracts';
import { reportToCsv } from './report-csv';

/**
 * The document columns of `REPORT_CSV_COLUMNS` are the tests that were missing.
 *
 * `apps/api/src/reports/csv.spec.ts` proves the writer escapes cells correctly, but it is handed its
 * own header and rows, so it cannot notice that a report declared columns its rows never emitted.
 * That failure is silent by construction: `buildCsv` pads a short row with blanks and drops an extra
 * cell, so the exported sheet stayed well-formed while every `Document Reference` and
 * `Document Link (local application only)` cell was empty in every row — a header promising data the
 * file never carried. These cases assert the whole line instead, because a partially correct CSV
 * still misleads whoever opens it.
 */

const ACCESS_NOTE = 'Valid only while this local application is running at the same address.';

const PERIOD = {
  preset: 'thisMonth',
  label: 'This Month',
  from: '2026-09-01',
  to: '2026-09-30',
  timezone: 'Asia/Kolkata',
} as const;

const ATTACHED: ReportDocumentLink = {
  documentId: 'e5000000-0000-4000-8000-000000000001',
  referenceId: 'HY-DOC-000001',
  originalFilename: 'offering.png',
  storagePath: '/api/v1/documents/e5000000-0000-4000-8000-000000000001/download',
  locallyReachable: true,
  accessNote: ACCESS_NOTE,
};

const UNREACHABLE: ReportDocumentLink = { ...ATTACHED, locallyReachable: false };

function transactionRow(
  document: ReportDocumentLink | null,
): TransactionListReport['rows'][number] {
  return {
    id: 'e4000000-0000-4000-8000-000000000001',
    referenceId: 'HY-INC-000001',
    amount: '1000.00',
    currency: 'INR',
    paymentMethod: 'CASH',
    businessDate: '2026-09-06',
    description: 'Sunday offering',
    memberName: null,
    memberReferenceId: null,
    categoryName: null,
    incomeType: 'OFFERING',
    documentCount: document === null ? 0 : 1,
    hasAvailableDocument: document !== null,
    document,
  };
}

function transactionListReport(rows: TransactionListReport['rows']): TransactionListReport {
  return {
    reportId: 'offerings',
    period: PERIOD,
    currency: 'INR',
    total: '1000.00',
    transactionCount: rows.length,
    rows,
    rowsTruncated: false,
    generatedAt: '2026-09-30T10:30:00.000Z',
  };
}

function completeTransactionReport(
  rows: CompleteTransactionReport['rows'],
): CompleteTransactionReport {
  return {
    reportId: 'transactions',
    period: PERIOD,
    currency: 'INR',
    type: null,
    status: null,
    total: '1000.00',
    transactionCount: rows.length,
    rows,
    pagination: { page: 1, pageSize: 20, totalItems: rows.length, totalPages: 1 },
    generatedAt: '2026-09-30T10:30:00.000Z',
  };
}

function completeTransactionRow(
  document: ReportDocumentLink | null,
): CompleteTransactionReport['rows'][number] {
  return {
    id: 'e4000000-0000-4000-8000-000000000001',
    referenceId: 'HY-INC-000001',
    type: 'INCOME',
    incomeType: 'OFFERING',
    amount: '1000.00',
    currency: 'INR',
    paymentMethod: 'CASH',
    status: 'ACTIVE',
    businessDate: '2026-09-06',
    description: null,
    notes: null,
    member: null,
    category: null,
    contributionPeriod: null,
    voidReason: null,
    voidedAt: null,
    documentCount: document === null ? 0 : 1,
    revision: 1,
    createdAt: '2026-09-06T06:00:00.000Z',
    updatedAt: '2026-09-06T06:00:00.000Z',
    document,
  };
}

/** The header line and every data line of an export, so a width can be compared to the header. */
function linesOf(csv: string): readonly string[] {
  return csv.trimEnd().split('\r\n');
}

describe('the document columns of an income-type report export', () => {
  it('fills both document columns when a document is attached', () => {
    const csv = reportToCsv('offerings', transactionListReport([transactionRow(ATTACHED)]));

    expect(csv).toBe(
      `${REPORT_CSV_COLUMNS.offerings.join(',')}\r\n` +
        `HY-INC-000001,2026-09-06,1000.00,CASH,,Sunday offering,HY-DOC-000001,${ACCESS_NOTE}\r\n`,
    );
  });

  it('leaves both document columns blank when no document is attached', () => {
    const csv = reportToCsv('donations', transactionListReport([transactionRow(null)]));

    // Absent is not the same fact as unavailable: a row with no attachment writes two empty cells
    // rather than claiming a document exists but cannot be opened.
    expect(csv).toBe(
      `${REPORT_CSV_COLUMNS.donations.join(',')}\r\n` +
        'HY-INC-000001,2026-09-06,1000.00,CASH,,Sunday offering,,\r\n',
    );
  });

  it('says an attached document is unavailable instead of promising a link', () => {
    const csv = reportToCsv('offerings', transactionListReport([transactionRow(UNREACHABLE)]));

    expect(linesOf(csv)[1]).toContain(`HY-DOC-000001,Unavailable — ${ACCESS_NOTE}`);
  });

  it('gives every row exactly as many cells as the header declares', () => {
    const csv = reportToCsv(
      'offerings',
      transactionListReport([transactionRow(ATTACHED), transactionRow(null)]),
    );
    const [header, ...rows] = linesOf(csv);

    for (const row of rows) {
      expect(row.split(',')).toHaveLength(header?.split(',').length ?? 0);
    }
  });
});

describe('the document columns of the Complete Transaction export', () => {
  it('fills both document columns, keeping the absent columns between blank', () => {
    const csv = reportToCsv(
      'transactions',
      completeTransactionReport([completeTransactionRow(ATTACHED)]),
    );

    expect(csv).toBe(
      `${REPORT_CSV_COLUMNS.transactions.join(',')}\r\n` +
        `HY-INC-000001,INCOME,OFFERING,1000.00,CASH,ACTIVE,2026-09-06,,,,,HY-DOC-000001,${ACCESS_NOTE}\r\n`,
    );
  });

  it('gives every row exactly as many cells as the header declares', () => {
    const csv = reportToCsv(
      'transactions',
      completeTransactionReport([completeTransactionRow(ATTACHED), completeTransactionRow(null)]),
    );
    const [header, ...rows] = linesOf(csv);

    for (const row of rows) {
      expect(row.split(',')).toHaveLength(header?.split(',').length ?? 0);
    }
  });
});
