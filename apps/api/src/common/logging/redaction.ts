const SENSITIVE_KEY_PATTERN =
  /(pass(word|phrase)?|secret|token|cookie|authorization|credential|session|csrf|api[-_]?key|private[-_]?key)/i;

export const REDACTED_VALUE = '[REDACTED]';

const MAX_DEPTH = 6;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Deep copy that replaces values whose key looks sensitive. Used for every
 * structured log field so a future module cannot leak a credential by logging a
 * request object. See `docs/07-SECURITY-RULES.md`.
 */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED_VALUE : redact(entry, depth + 1, seen);
  }

  return result;
}
