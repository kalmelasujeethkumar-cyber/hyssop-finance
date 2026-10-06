import { CSV_CONTENT_TYPE } from '@hyssop/contracts';

/**
 * The one save-a-CSV-as-a-file step, shared by every CSV route in the web app.
 *
 * It lives here rather than inside a feature module because the concern is browser-only and has no
 * business knowledge at all: given bytes the API already returned, put them on disk. Two features
 * that each hand-rolled this would drift, and the failure mode is silent -- a revoked object URL
 * before the click lands produces a file named `download` with no contents, which looks like a
 * server bug and is not one.
 *
 * Exported separately from the fetch on purpose. A screen, a test, and a future "reuse the last
 * export" action all need to perform the identical save step, and the browser-only concerns --
 * creating the blob, clicking, revoking -- belong in one reviewed place.
 */
export function saveCsvTextFile(
  text: string,
  filename: string | undefined,
  fallbackFilename: string,
): void {
  const blob = new Blob([text], { type: CSV_CONTENT_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  try {
    anchor.href = url;
    // The API owns the filename whenever it declared one; the fallback only stands in for a
    // response that sent no `Content-Disposition`.
    anchor.download = filename ?? fallbackFilename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Revoked immediately after the click: the browser has already taken a reference to the blob,
    // and holding it longer would keep the whole export alive for nothing. A 10,000-row export is
    // not something to hold twice.
    URL.revokeObjectURL(url);
  }
}
