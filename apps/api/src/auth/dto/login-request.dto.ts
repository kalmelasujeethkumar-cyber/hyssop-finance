import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  LOGIN_IDENTIFIER_MAX_LENGTH,
  LOGIN_IDENTIFIER_MIN_LENGTH,
} from '@hyssop/contracts';

/**
 * The `POST /api/v1/auth/login` body.
 *
 * Authority: `docs/06-API-SPEC.md` and the validation requirement in
 * `docs/07-SECURITY-RULES.md` ("Validate all input on the server"). The global
 * `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`, so an unexpected
 * field is rejected rather than silently ignored.
 *
 * The password is bounded by length only; the policy itself is documented in
 * `credential-policy.ts` and shared with the browser through the contract, so the two
 * cannot drift. The plaintext exists only in this object and in the Argon2id call: it is
 * never logged, audited, or stored.
 */
export class LoginRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(LOGIN_IDENTIFIER_MIN_LENGTH)
  @MaxLength(LOGIN_IDENTIFIER_MAX_LENGTH)
  public identifier!: string;

  @IsString()
  @MinLength(ADMIN_PASSWORD_MIN_LENGTH)
  @MaxLength(ADMIN_PASSWORD_MAX_LENGTH)
  public password!: string;
}
