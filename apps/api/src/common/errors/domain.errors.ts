/**
 * Domain errors raised by the persistence layer.
 *
 * These are transport-agnostic on purpose. A later phase maps them to the error
 * envelope in `docs/06-API-SPEC.md`; Phase 02 persistence must not invent HTTP
 * semantics, and `ApiExceptionFilter` already converts any unhandled value into a
 * safe 500 without leaking internals.
 */

export type DomainErrorKind =
  'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT' | 'STALE_REVISION' | 'CONSTRAINT_VIOLATION';

export class DomainError extends Error {
  public constructor(
    public readonly kind: DomainErrorKind,
    message: string,
    public readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function notFound(entity: string, identifier: string): DomainError {
  return new DomainError('NOT_FOUND', `${entity} was not found.`, { entity, identifier });
}

export function validationFailed(
  message: string,
  details: Readonly<Record<string, string>> = {},
): DomainError {
  return new DomainError('VALIDATION_FAILED', message, details);
}

export function conflict(
  message: string,
  details: Readonly<Record<string, string>> = {},
): DomainError {
  return new DomainError('CONFLICT', message, details);
}

export function staleRevision(entity: string, expected: number, actual: number): DomainError {
  return new DomainError(
    'STALE_REVISION',
    `${entity} was changed by someone else. Refresh and try again.`,
    {
      entity,
      expectedRevision: String(expected),
      actualRevision: String(actual),
    },
  );
}

export function constraintViolation(
  message: string,
  details: Readonly<Record<string, string>> = {},
): DomainError {
  return new DomainError('CONSTRAINT_VIOLATION', message, details);
}
