import {
  EXPENSE_TRANSACTION_CSV_COLUMNS,
  REPORT_CSV_COLUMNS,
  type CompleteTransactionReport,
  type ExpenseTransactionCsvRow,
  type ReportDocumentLink,
  type TransactionListReport,
} from '@hyssop/contracts';
import { expenseTransactionsToCsv, reportToCsv } from './report-csv';

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
    // Income carries no reason, which is what `REQ-EXP-005` requires of every income row.
    expenseReason: null,
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

/**
 * The single data line of an export that is expected to hold exactly one row.
 *
 * Returning a narrowed `string` rather than `string | undefined` means an export that silently lost
 * its data row fails as a plain wrong-value assertion instead of as a `TypeError` inside the test.
 */
function dataLineOf(csv: string): string {
  const [, row] = linesOf(csv);
  expect(row).toBeDefined();

  return row ?? '';
}

/**
 * Splits one CSV line into its cells, honouring quoted cells.
 *
 * `row.split(',')` is wrong for any row whose note or category contains a comma: it reports more
 * cells than the row has, which would make a width assertion pass for the wrong reason and hide a
 * genuinely misaligned row. This is a test helper, so it only has to handle what the writer emits.
 */
function parseCsvRow(line: string): readonly string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);

    if (quoted) {
      if (character !== '"') {
        current += character;
        continue;
      }

      // A doubled quote inside a quoted cell is one literal quote; anything else ends the cell.
      if (line.charAt(index + 1) === '"') {
        current += '"';
        index += 1;
        continue;
      }

      quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === ',') {
      cells.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(current);

  return cells;
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

/**
 * The expense transactions CSV is a separate writer with its own approved columns, so the column
 * contract has to be asserted against it directly. `buildCsv` pads a short row and drops an extra
 * cell, so a writer that emitted the wrong columns would still produce a well-formed file whose
 * header and data disagree — a silent export failure that only a reader of the sheet would notice.
 */
describe('the expense transactions CSV export', () => {
  const RECEIPT_PATH = '/api/v1/documents/e5000000-0000-4000-8000-000000000001/download';

  function expenseRow(overrides: Partial<ExpenseTransactionCsvRow> = {}): ExpenseTransactionCsvRow {
    return {
      referenceId: 'HY-EXP-000001',
      expenseDate: '18-09-2026',
      categoryName: 'Repairs',
      reasonName: 'Equipment Repair',
      amount: '800.00',
      paymentMethod: 'CASH',
      notes: null,
      receiptUrl: null,
      ...overrides,
    };
  }

  it('writes the approved columns in order, with the row values in that same order', () => {
    const csv = expenseTransactionsToCsv([expenseRow()]);

    expect(EXPENSE_TRANSACTION_CSV_COLUMNS).toEqual([
      'Expense ID',
      'Expense Date',
      'Category',
      'Reason',
      'Amount',
      'Payment Method',
      'Notes',
      'Receipt URL',
    ]);
    expect(csv).toBe(
      `${EXPENSE_TRANSACTION_CSV_COLUMNS.join(',')}\r\n` +
        'HY-EXP-000001,18-09-2026,Repairs,Equipment Repair,800.00,Cash,,\r\n',
    );
  });

  it('leaves the Receipt URL cell empty when there is no receipt', () => {
    const csv = expenseTransactionsToCsv([expenseRow({ receiptUrl: null })]);
    const row = dataLineOf(csv);

    // The column holds URLs, so an absent receipt is an empty cell rather than placeholder words
    // that would look like a link a spreadsheet might try to open. `REQ-DOC-003` still requires
    // the *interface* to say **Receipt Missing**; that is a screen obligation and stops here.
    expect(row).toBe('HY-EXP-000001,18-09-2026,Repairs,Equipment Repair,800.00,Cash,,');
    expect(row).not.toContain('Receipt Missing');
    expect(row.endsWith(',')).toBe(true);
  });

  it('writes the authenticated download path when a receipt is attached', () => {
    const csv = expenseTransactionsToCsv([expenseRow({ receiptUrl: RECEIPT_PATH })]);

    expect(linesOf(csv)[1]).toBe(
      `HY-EXP-000001,18-09-2026,Repairs,Equipment Repair,800.00,Cash,,${RECEIPT_PATH}`,
    );
  });

  it('keeps the amount exact and ungrouped, and the payment method human-readable', () => {
    const csv = expenseTransactionsToCsv([
      expenseRow({ amount: '2450.75', paymentMethod: 'BANK_TRANSFER', notes: 'Paid by transfer' }),
    ]);

    // `2450.75`, not `2,450.75`: a grouped amount would not re-import as the same number, and the
    // stored paise must survive the export unaltered.
    expect(linesOf(csv)[1]).toBe(
      'HY-EXP-000001,18-09-2026,Repairs,Equipment Repair,2450.75,Bank Transfer,Paid by transfer,',
    );
  });

  it('guards an Admin-entered reason or note that a spreadsheet would treat as a formula', () => {
    const csv = expenseTransactionsToCsv([
      expenseRow({ categoryName: '=cmd()', reasonName: '+1+1', notes: '@SUM(A1)' }),
    ]);

    // A category, reason, or note is stored Admin text and may legitimately start with `=`, `+`,
    // or `@`. `csv.ts` prefixes such a cell with a single quote, which spreadsheets display as a
    // literal character and never execute -- so the guard is asserted in that exact form rather
    // than as double quotes, which would mean structural quoting instead of the guard.
    expect(linesOf(csv)[1]).toBe("HY-EXP-000001,18-09-2026,'=cmd(),'+1+1,800.00,Cash,'@SUM(A1),");
  });

  it('quotes a note containing a comma without splitting the row', () => {
    const csv = expenseTransactionsToCsv([expenseRow({ notes: 'Bought on 2 Sept, cash' })]);
    const row = dataLineOf(csv);

    expect(row).toContain('"Bought on 2 Sept, cash"');
    // Counting raw commas would be wrong here -- the quoted note legitimately contains one -- so
    // the row is checked by its parsed cell count instead.
    expect(parseCsvRow(row)).toHaveLength(EXPENSE_TRANSACTION_CSV_COLUMNS.length);
    expect(parseCsvRow(row)).toEqual([
      'HY-EXP-000001',
      '18-09-2026',
      'Repairs',
      'Equipment Repair',
      '800.00',
      'Cash',
      'Bought on 2 Sept, cash',
      '',
    ]);
    expect(linesOf(csv)[0]).toBe(EXPENSE_TRANSACTION_CSV_COLUMNS.join(','));
  });

  it('gives every row exactly as many cells as the header declares', () => {
    const csv = expenseTransactionsToCsv([
      expenseRow({ receiptUrl: RECEIPT_PATH }),
      expenseRow({ referenceId: 'HY-EXP-000002', receiptUrl: null, notes: 'a note, with comma' }),
    ]);
    const rows = linesOf(csv).slice(1);

    for (const row of rows) {
      expect(parseCsvRow(row)).toHaveLength(EXPENSE_TRANSACTION_CSV_COLUMNS.length);
    }
  });

  it('writes only the header when no expense matched, rather than a blank data row', () => {
    // A header-only file is the honest result of an empty filtered export; padding it with one
    // empty row would suggest an expense exists with nothing in it.
    expect(expenseTransactionsToCsv([])).toBe(`${EXPENSE_TRANSACTION_CSV_COLUMNS.join(',')}\r\n`);
  });
});
