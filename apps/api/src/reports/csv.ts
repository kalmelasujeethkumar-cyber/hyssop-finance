/**
 * RFC 4180 CSV writing for report exports.
 *
 * Authority: `docs/06-API-SPEC.md` ("CSV export with documented columns and escaping") and
 * `docs/01-REQUIREMENTS.md` `REQ-EXPORT-001`, `REQ-EXPORT-002`.
 *
 * This module is deliberately pure: it takes already-projected cells and returns text, so the
 * escaping rules can be asserted exactly without a database, and so the exporter cannot be a
 * second place that formats money.
 *
 * Two separate hazards are handled, and they are not the same rule:
 *
 * 1. **Structural escaping.** A cell containing a comma, a double quote, a newline, or a leading
 *    or trailing space must be quoted, and an embedded quote doubled. A member named
 *    `Anita, Kumaran` or a description containing a quote would otherwise shift every later
 *    column by one, which silently corrupts an exported financial sheet.
 * 2. **Formula injection.** A text cell beginning with `=`, `+`, `@`, tab, or carriage return is
 *    evaluated as a formula by Excel, LibreOffice, and Google Sheets when the sheet is opened.
 *    An Admin-entered description is untrusted text as far as a spreadsheet is concerned, so such
 *    a cell is prefixed with a single quote, which those applications display as a literal
 *    character and never execute.
 *
 * The formula guard is applied to *text* cells only. Amounts are produced by `formatPaise` as
 * decimal strings and can legitimately begin with `-` — a negative method balance is a required,
 * honest result under `REQ-FIN-012` — so prefixing them would corrupt the very figures this phase
 * exists to export.
 */

/** The RFC 4180 line separator. `\r\n` is what spreadsheet applications expect. */
const LINE_SEPARATOR = '\r\n';

/** Characters that make a spreadsheet treat a cell as a formula rather than as text. */
const FORMULA_LEAD = new Set(['=', '+', '@', '\t', '\r']);

/**
 * Escapes one already-stringified cell for structural correctness.
 *
 * `null` and `undefined` become an empty cell rather than the words "null" or "undefined", so an
 * absent description exports as a blank the Admin recognises instead of a value that looks like
 * data.
 */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const text =
    value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value);

  const needsQuotes =
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text.startsWith(' ') ||
    text.endsWith(' ');

  if (!needsQuotes) {
    return text;
  }

  return `"${text.replace(/"/gu, '""')}"`;
}

/**
 * Escapes an Admin-entered text cell, adding the formula-injection guard.
 *
 * `isText` distinguishes this from a generated numeric cell. Callers pass `true` for columns whose
 * content came from a member name, category, description, filename, reason, or similar, and
 * `false` for money and dates, which this project generates and which may start with `-`.
 *
 * The guard is applied to the *value* and the result is then escaped, never the other way round.
 * Prefixing after escaping would put the single quote outside the quoting, producing a cell like
 * `'=A1,B2` whose opening quote is never closed — the row would parse as fewer columns than the
 * header and every column after it would be misaligned. Guarding first keeps the apostrophe
 * ordinary cell content that the escaper is free to quote.
 */
export function escapeCsvText(
  value: string | number | boolean | null | undefined,
  isText: boolean,
): string {
  if (!isText || value === null || value === undefined) {
    return escapeCsvCell(value);
  }

  const text = typeof value === 'string' ? value : String(value);

  return escapeCsvCell(FORMULA_LEAD.has(text.charAt(0)) ? `'${text}` : text);
}

/** The filename a report's export is offered under. */
export function csvFilename(reportId: string): string {
  return `${reportId}-report.csv`;
}

/**
 * A value to write, optionally flagged as untrusted text.
 *
 * Most cells are plain values. A cell that carries Admin-entered content is wrapped as
 * `{ value, text: true }` so the formula-injection guard applies to it, while generated money and
 * dates stay bare so a negative amount keeps its sign.
 */
export type CsvCell =
  | string
  | number
  | boolean
  | null
  | undefined
  | { readonly value: string | number | boolean | null | undefined; readonly text: true };

/** Unwraps a {@link CsvCell} into its value and whether it is untrusted text. */
function partsOf(cell: CsvCell): {
  readonly value: string | number | boolean | null | undefined;
  readonly isText: boolean;
} {
  if (typeof cell === 'object' && cell !== null && 'value' in cell) {
    return { value: cell.value, isText: cell.text };
  }

  return { value: cell, isText: false };
}

/**
 * Serialises a header row and data rows into a CSV document.
 *
 * Every data row is written with exactly the header's number of cells. A short row is padded with
 * blanks, which a spreadsheet reads as an empty column, rather than being trusted to match.
 */
export function buildCsv(header: readonly string[], rows: readonly CsvCell[][]): string {
  const lines: string[] = [header.map(escapeCsvCell).join(',')];

  for (const row of rows) {
    const cells: string[] = [];

    for (let index = 0; index < header.length; index += 1) {
      const cell = row[index];
      const { value, isText } = partsOf(cell === undefined ? null : cell);
      cells.push(escapeCsvText(value, isText));
    }

    lines.push(cells.join(','));
  }

  return lines.join(LINE_SEPARATOR) + LINE_SEPARATOR;
}
