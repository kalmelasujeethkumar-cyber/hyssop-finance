/**
 * Turning a stored audit snapshot into flat, safe, renderable fields.
 *
 * Authority: `docs/07-SECURITY-RULES.md` (audit events must not expose secrets or unnecessary
 * personal data) and `docs/01-REQUIREMENTS.md` `REQ-AUDIT-002` (a viewer must be able to see
 * what changed). Both are satisfied by one rule applied in one place: **the API decides what a
 * viewer may read, and the browser is handed strings.**
 *
 * The `audit_event.before` and `audit_event.after` columns hold arbitrary JSON written by
 * whatever code performed the change. That is the right thing for storage - a snapshot that has
 * to be interpreted by whoever wrote it - and the wrong thing to send to a browser:
 *
 * - A snapshot is a *snapshot*, so it is nested by nature. A member edit holds an address object;
 *   a settings change holds an array of payment methods. Sending the JSON raw would leave the
 *   browser to decide how to render a nested value, and two screens would render the same
 *   snapshot differently.
 * - A snapshot is *arbitrary*, so it may contain a key that should never be shown. The stored
 *   value is whatever some future module chose to pass. Redaction therefore happens on the way
 *   out, reusing the same {@link isSensitiveKey} rule that protects every structured log field,
 *   so a credential cannot be leaked here that would already be safe in a log line.
 *
 * Redaction replaces the value with a marker and keeps the field, rather than dropping the field.
 * Dropping it would make the snapshot read as if that part of the record had never existed, which
 * is a different and false statement.
 */

import { Prisma } from '@prisma/client';
import type { AuditDetailField } from '@hyssop/contracts';
import { REDACTED_VALUE, isSensitiveKey } from '../common/logging/redaction';

/**
 * How deep a snapshot is walked before it stops.
 *
 * Six matches the log redactor's `MAX_DEPTH`. The bound exists so a snapshot containing a
 * pathological structure cannot produce an unbounded response, and the value at the boundary is
 * stated rather than silently cut, so a viewer can see that something more was recorded.
 */
const MAX_SNAPSHOT_DEPTH = 6;

/** What a field reads when its stored value was `null`, as distinct from an absent field. */
const NULL_VALUE = '—';

/** The maximum length of one rendered value. A snapshot is not free text to page through. */
const MAX_VALUE_LENGTH = 500;

/**
 * Whether a stored snapshot holds a recorded value at all.
 *
 * A creation records no `before`, and `docs/05-DATABASE-SPEC.md` allows the column to be SQL
 * `NULL`. Prisma writes that as `Prisma.JsonNull` and reads a JSON null back as JavaScript `null`,
 * so both are checked: a snapshot is recorded when and only when it is neither. A recorded empty
 * object returns `true`, which is the whole point - "nothing here" and "nothing was recorded"
 * are different facts and `docs/03-UI-UX-RULES.md` requires the screen to be able to tell them
 * apart.
 */
export function isRecordedSnapshot(value: unknown): boolean {
  return value !== null && value !== undefined && value !== Prisma.JsonNull;
}

/**
 * Flattens one stored snapshot into ordered label/value fields.
 *
 * Order follows the stored object's own key order, so a member's fields appear in the order the
 * write chose rather than in an alphabetical order that would differ between two snapshots of
 * different shapes. Arrays keep their index in the key (`enabledPaymentMethods[0]`), because an
 * ordered set is meaningful - which payment methods were enabled - and dropping the index would
 * turn it into an unordered set that reads as the same value.
 */
export function flattenSnapshot(snapshot: unknown): readonly AuditDetailField[] {
  // An absent snapshot produces no fields at all. Without this the walk would render the sentinel
  // as an empty object or the SQL null as a leaf, and a creation would show a "before" panel
  // implying a prior state that never existed.
  if (!isRecordedSnapshot(snapshot)) {
    return [];
  }

  const fields: AuditDetailField[] = [];

  walk(snapshot, '', fields, 0);

  return fields;
}

/** Recurses through objects and arrays, appending one field per leaf value. */
function walk(value: unknown, path: string, fields: AuditDetailField[], depth: number): void {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    fields.push({ key: path, label: labelOf(path), value: '[TRUNCATED]', redacted: false });
    return;
  }

  if (Array.isArray(value)) {
    // An empty array is a recorded value in its own right: "no methods are enabled" is
    // different from "this snapshot has no methods key".
    if (value.length === 0) {
      fields.push({ key: path, label: labelOf(path), value: '(none)', redacted: false });
      return;
    }

    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, fields, depth + 1);
    });

    return;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      fields.push({ key: path, label: labelOf(path), value: '(empty)', redacted: false });
      return;
    }

    for (const [key, entry] of entries) {
      const childPath = path === '' ? key : `${path}.${key}`;

      if (isSensitiveKey(key)) {
        fields.push({
          key: childPath,
          label: labelOf(childPath),
          value: REDACTED_VALUE,
          redacted: true,
        });
        continue;
      }

      walk(entry, childPath, fields, depth + 1);
    }

    return;
  }

  fields.push({
    key: path,
    label: labelOf(path),
    value: leafValue(value),
    redacted: false,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Renders one leaf value as the string the screen displays.
 *
 * Everything becomes a string here so the browser cannot re-interpret a stored type - a
 * description containing `<script>` is text the browser must not execute, and a stored number
 * cannot silently become an arithmetic input. Strings pass through unchanged apart from the length
 * bound; everything else is serialised as JSON, which keeps a boolean recognisable as `true` and
 * keeps the shape of anything that reached the leaf because it was a map rather than a list.
 * `String(value)` would have been the wrong choice there: `String({ a: 1 })` is `[object Object]`,
 * which tells a viewer nothing at all.
 */
function leafValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return NULL_VALUE;
  }

  if (typeof value === 'string') {
    return truncate(value);
  }

  return truncate(JSON.stringify(value));
}

/** Bounds one rendered value; a snapshot is not free text to page through. */
function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/**
 * The human label for a stored key.
 *
 * The stored key is already a field name chosen by the code that wrote the snapshot, so it is
 * *read* rather than replaced with a guessed vocabulary: a snapshot written by a feature this
 * contract has never heard of still produces a readable label instead of a blank row or a wrong
 * one. What is transformed is the shape - dots, underscores, and camel-case boundaries become
 * spaces - because `voidReason` or `expected_paise` shown as-is is machine text, and the audience
 * is a non-technical pastor (`AGENTS.md` "Product constraints").
 *
 * Index suffixes are dropped, because `enabledPaymentMethods[0]` and `[1]` are the same field.
 */
export function labelOf(path: string): string {
  const words = path
    .replace(/\[\d+\]/g, '')
    .split('.')
    .flatMap((part) => part.split('_'))
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? [])
    .filter((word) => word !== '');

  if (words.length === 0) {
    return 'Value';
  }

  return words.map(capitalise).join(' ');
}

/**
 * Upper-cases the first character of one word and leaves the rest as it was written.
 *
 * `charAt` rather than `[0]` because a word that reached here is non-empty but the language still
 * types an index access as possibly `undefined`, and the resulting assertion would be the kind
 * that hides a real emptiness bug.
 */
function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
