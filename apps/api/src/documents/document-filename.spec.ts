import { ApiError } from '../common/errors/api-error';
import { sanitiseForHeader } from '../storage/document-storage';
import { assertUploadFilename, sanitiseOriginalFilename } from './document-filename';

/**
 * Upload filename handling.
 *
 * Authority: `docs/07-SECURITY-RULES.md` requires safe filenames and path-traversal protection, and
 * `REQ-DOC-004` requires the server to validate rather than trusting what the client sent.
 *
 * The distinction under test throughout is the one the implementation draws: a filename is only ever
 * a *label*, so cosmetic problems are sanitised, while a name that is a **path** is refused outright
 * — because no file picker sends one, so its presence means the request was hand-assembled.
 */

describe('assertUploadFilename', () => {
  it('accepts an ordinary file name', () => {
    expect(() => {
      assertUploadFilename('september-electricity-bill.pdf');
    }).not.toThrow();
  });

  it('refuses a name containing a path separator', () => {
    // The traversal case. Rejecting rather than sanitising is deliberate: silently rewriting
    // `../../../etc/passwd` into `passwd` would hide a hand-crafted request behind a success.
    for (const hostile of [
      '../../../etc/passwd',
      '..\\..\\windows\\system32\\config\\sam',
      'receipts/September/bill.pdf',
      'C:\\Users\\Someone\\Desktop\\bill.pdf',
    ]) {
      expect(() => {
        assertUploadFilename(hostile);
      }).toThrow(ApiError);
    }
  });

  it('refuses an empty or whitespace-only name', () => {
    for (const empty of ['', '   ', '\t', '\n']) {
      expect(() => {
        assertUploadFilename(empty);
      }).toThrow(ApiError);
    }
  });

  it('refuses a name longer than the column can store', () => {
    expect(() => {
      assertUploadFilename(`${'a'.repeat(256)}.pdf`);
    }).toThrow(ApiError);
  });

  it('refuses a name carrying a control character', () => {
    // A newline or NUL in a stored name is a header-injection and truncation hazard.
    for (const injected of ['bill\u0000.pdf', 'bill\n.pdf', 'bill\r\nX-Evil: 1.pdf']) {
      expect(() => {
        assertUploadFilename(injected);
      }).toThrow(ApiError);
    }
  });

  it('rejects consistently, so a control character is never accepted after a prior rejection', () => {
    // Guards the stateful-regex hazard: `.test` on a global pattern carries `lastIndex` between
    // calls, so an implementation that shared one pattern would pass this on the second attempt
    // and silently accept the very input it had just refused.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => {
        assertUploadFilename('bill\u0000.pdf');
      }).toThrow(ApiError);
    }
  });
});

describe('sanitiseOriginalFilename', () => {
  it('keeps a normal name recognisable', () => {
    expect(sanitiseOriginalFilename('September Electricity Bill.pdf')).toBe(
      'September Electricity Bill.pdf',
    );
  });

  it('reduces a path to its final segment rather than preserving any directory', () => {
    expect(sanitiseOriginalFilename('../../secret.png')).toBe('secret.png');
    expect(sanitiseOriginalFilename('C:\\temp\\scan.jpg')).toBe('scan.jpg');
  });

  it('never returns an empty name', () => {
    // The Admin must always be able to tell two attachments apart, so an unusable name becomes a
    // fixed label instead of failing an otherwise valid upload.
    expect(sanitiseOriginalFilename('')).not.toBe('');
    expect(sanitiseOriginalFilename('   ')).not.toBe('');
    expect(sanitiseOriginalFilename('...')).not.toBe('');
  });

  it('strips control characters', () => {
    expect(sanitiseOriginalFilename('bill\u0000\u0007.pdf')).toBe('bill.pdf');
  });

  it('keeps punctuation that is legitimate in a label', () => {
    // A comma is common and harmless in a real receipt name ("Bill, September.pdf"). Over-scrubbing
    // it would make the Admin's own file names unrecognisable, and the stored value is only a label.
    expect(sanitiseOriginalFilename('Bill, September.pdf')).toBe('Bill, September.pdf');
  });

  it('removes characters that would break a response header', () => {
    // The dangerous set is enforced where it actually matters — at header emission — rather than in
    // storage. `sanitiseForHeader` is what feeds `Content-Disposition`, so that is what must strip a
    // quote, a backslash, or a parameter separator that could inject a second header directive.
    expect(sanitiseForHeader('bill";attachment.pdf')).not.toMatch(/["\\;,]/);
    expect(sanitiseForHeader('a,b;c.pdf')).not.toMatch(/["\\;,]/);
    // eslint-disable-next-line no-control-regex -- a control character is the exact subject
    expect(sanitiseForHeader('bill\r\nX-Evil: 1.pdf')).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it('falls back to a derived name when nothing usable survives header sanitisation', () => {
    expect(sanitiseForHeader('..')).toBe('');
    expect(sanitiseForHeader('')).toBe('');
  });

  it('prefixes a Windows reserved device name so the file can still be written out', () => {
    expect(sanitiseOriginalFilename('CON')).toBe('_CON');
    expect(sanitiseOriginalFilename('nul.pdf')).toBe('_nul.pdf');
  });

  it('bounds the length to what the column and the header can carry', () => {
    expect(sanitiseOriginalFilename(`${'b'.repeat(400)}.pdf`).length).toBeLessThanOrEqual(255);
  });
});
