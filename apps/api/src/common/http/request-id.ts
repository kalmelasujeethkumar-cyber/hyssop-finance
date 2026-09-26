import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reuses a syntactically valid client request ID so a browser trace and a server
 * log line can be correlated, and replaces anything else with a generated UUID so
 * untrusted input never reaches a log key unfiltered.
 */
export function resolveRequestId(
  raw: string | string[] | undefined,
  generate: () => string = () => randomUUID(),
): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  if (typeof candidate === 'string' && UUID_PATTERN.test(candidate.trim())) {
    return candidate.trim();
  }

  return generate();
}
