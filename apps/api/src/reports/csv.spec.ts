import { buildCsv, csvFilename, escapeCsvCell, escapeCsvText } from './csv';

/**
 * `REQ-EXPORT-001` / `REQ-EXPORT-002` escaping tests.
 *
 * These assertions exist because the failure they guard against is silent: a mis-escaped CSV does
 * not error, it simply shifts the columns of every row after the offending cell, and a shifted
 * financial column looks like plausible data. Each case below reproduces a value an Admin could
 * realistically type, reference, or have generated from a member name.
 */
describe('escapeCsvCell', () => {
  it('leaves an ordinary value untouched', () => {
    expect(escapeCsvCell('Offering')).toBe('Offering');
    expect(escapeCsvCell('1234.00')).toBe('1234.00');
  });

  it('quotes a value containing a comma, because an unquoted one shifts every later column', () => {
    expect(escapeCsvCell('Anita, Kumaran')).toBe('"Anita, Kumaran"');
  });

  it('doubles an embedded double quote, per RFC 4180', () => {
    expect(escapeCsvCell('The "grace" fund')).toBe('"The ""grace"" fund"');
  });

  it('quotes a value containing a newline so the row count is preserved', () => {
    expect(escapeCsvCell('first line\nsecond line')).toBe('"first line\nsecond line"');
  });

  it('quotes leading and trailing spaces, which a spreadsheet would otherwise strip', () => {
    expect(escapeCsvCell(' padded ')).toBe('" padded "');
  });

  it('writes an absent value as a blank cell rather than the text "null"', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('preserves a negative number, because a negative method balance is a real result', () => {
    expect(escapeCsvCell('-1500.00')).toBe('-1500.00');
  });
});

describe('escapeCsvText', () => {
  it.each(['=1+1', '+1+1', '@SUM(A1)', '\tcmd'])(
    'neutralises a formula-injection lead character in %j',
    (value) => {
      expect(escapeCsvText(value, true)).toBe(`'${value}`);
    },
  );

  it('guards a carriage-return lead and still quotes it, because CR also breaks the row', () => {
    // The two rules apply together: the value is guarded first, then escaped, so the single quote
    // is inside the quoted cell rather than opening one that is never closed.
    expect(escapeCsvText('\rcmd', true)).toBe('"\'\rcmd"');
  });

  it('applies the guard to a formula lead even when the cell also needs quoting', () => {
    expect(escapeCsvText('=A1,B2', true)).toBe(`"'=A1,B2"`);
  });

  it('leaves ordinary text unprefixed', () => {
    expect(escapeCsvText('Church maintenance', true)).toBe('Church maintenance');
  });

  it('does not guard a generated numeric cell, so a negative amount keeps its sign', () => {
    expect(escapeCsvText('-1500.00', false)).toBe('-1500.00');
  });

  it('does not guard an absent value', () => {
    expect(escapeCsvText(null, true)).toBe('');
  });
});

describe('buildCsv', () => {
  it('writes the header, one line per row, and a trailing newline', () => {
    const csv = buildCsv(
      ['Reference', 'Amount'],
      [
        ['OFR-0001', '500.00'],
        ['OFR-0002', '250.00'],
      ],
    );

    expect(csv).toBe('Reference,Amount\r\nOFR-0001,500.00\r\nOFR-0002,250.00\r\n');
  });

  it('pads a short row to the header width instead of trusting it', () => {
    const csv = buildCsv(['A', 'B', 'C'], [['1']]);

    expect(csv).toBe('A,B,C\r\n1,,\r\n');
  });

  it('drops an extra cell that the header does not describe', () => {
    const csv = buildCsv(['A', 'B'], [['1', '2', '3']]);

    expect(csv).toBe('A,B\r\n1,2\r\n');
  });

  it('applies the text guard to a flagged cell and not to its neighbours', () => {
    // No quoting is needed for either value, so the row stays readable: the guard is a bare leading
    // apostrophe and the negative amount is untouched.
    const csv = buildCsv(['Name', 'Amount'], [[{ value: '=cmd|calc', text: true }, '-10.00']]);

    expect(csv).toBe("Name,Amount\r\n'=cmd|calc,-10.00\r\n");
  });

  it('emits only the header for an empty result set', () => {
    expect(buildCsv(['A', 'B'], [])).toBe('A,B\r\n');
  });

  it('writes no byte-order mark, so no stray glyph appears in the first header', () => {
    expect(buildCsv(['A'], [['1']]).startsWith('\uFEFF')).toBe(false);
  });
});

describe('csvFilename', () => {
  it('names the file after the report', () => {
    expect(csvFilename('financial-summary')).toBe('financial-summary-report.csv');
  });
});
