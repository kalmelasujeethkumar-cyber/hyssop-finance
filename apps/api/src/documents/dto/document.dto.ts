import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DOCUMENT_REMOVAL_REASON_MAX_LENGTH } from '@hyssop/contracts';

/**
 * Route parameters and bodies for the document routes.
 *
 * Authority: `docs/06-API-SPEC.md` and `docs/07-SECURITY-RULES.md` ("validate all input on the
 * server"). The global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`, so an
 * unexpected body property is rejected rather than ignored.
 *
 * The identifier shapes are re-declared here rather than imported from the transaction DTOs
 * because the documents module owns its own routes and must not reach into another module's DTO for
 * a path parameter. The pattern is identical, which is the part that matters: the same UUID shape
 * is required on both routes, so an identifier cannot be accepted in one place and refused in
 * another.
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Trims surrounding whitespace before validation.
 *
 * Applied to the removal reason so a reason typed with a trailing space or newline is stored as
 * what was meant. Without it, `MaxLength` would count characters the Admin could not see, and a
 * pasted reason would be rejected for being "too long" at a length they never typed.
 */
const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * The `:id` path parameter of `/documents/:id`.
 *
 * A UUID is required rather than a human reference. The document reference `HY-DOC-000001` is what
 * the Admin reads and the audit trail quotes, but the UUID is what addresses the row, and accepting
 * a reference here would mean a rejected reference is reported as a missing document — which would
 * tell the Admin a document they can see listed never existed.
 */
export class DocumentIdParamDto {
  @IsString()
  @Matches(UUID_PATTERN, { message: 'A document identifier must be a UUID.' })
  public id!: string;
}

/**
 * The `:id` path parameter of `/transactions/:id/documents`.
 *
 * Validated with the same UUID rule as every other transaction-scoped route, so an unknown
 * identifier is a `404` and a malformed one is a `400` on every route alike.
 */
export class TransactionIdParamDto {
  @IsString()
  @Matches(UUID_PATTERN, { message: 'A transaction identifier must be a UUID.' })
  public id!: string;
}

/**
 * The `DELETE /documents/:id` body.
 *
 * `REQ-DOC-006` requires a non-empty reason, and the reason is stored and audited, so `MinLength(1)`
 * after trimming is the floor and `MaxLength` matches the persistence bound. Trimming before both is
 * what makes a run of spaces fail `MinLength(1)` instead of passing it as a "reason" that explains
 * nothing.
 */
export class RemoveDocumentDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(DOCUMENT_REMOVAL_REASON_MAX_LENGTH)
  public reason!: string;
}
