import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { getAppEnvironment, type Argon2Parameters } from '../config/environment';

/**
 * The Argon2id algorithm identifier of `@node-rs/argon2` (2 of 0=d, 1=i, 2=id).
 *
 * It is written as a literal because that package declares `Algorithm` as an ambient
 * `const enum`, which `isolatedModules` forbids referencing as a value. The stored PHC
 * prefix is asserted to be `$argon2id$` by the password tests, so a wrong number here
 * fails a test rather than silently hashing with the wrong algorithm.
 */
const ARGON2ID = 2;

/**
 * Argon2id password hashing.
 *
 * Authority: `docs/07-SECURITY-RULES.md` ("Use Argon2id for password hashing where
 * practical, with a documented cost and an upgrade path") and `docs/06-API-SPEC.md`
 * (login "verifies Argon2id"). The cost is validated configuration rather than a
 * constant, and the defaults are the OWASP minimum for Argon2id (19 MiB, two
 * iterations, one lane), documented in `.env.example` and `DEC-064`.
 *
 * Upgrading the cost is a configuration change plus a re-hash on the next successful
 * sign-in: `needsRehash` reports a stored hash weaker than the configured parameters.
 */
@Injectable()
export class PasswordService {
  private dummyHash: string | null = null;

  public constructor(private readonly config: ConfigService) {}

  public async hash(password: string): Promise<string> {
    return argon2Hash(password, {
      algorithm: ARGON2ID,
      ...toArgon2Cost(this.parameters),
      outputLen: 32,
    });
  }

  /**
   * Verifies a candidate password. Returns `false` — never throws — for the documented
   * unusable-credential sentinel, a malformed stored hash, or a wrong password, so a
   * storage problem can never be mistaken for a successful sign-in.
   */
  public async verify(storedHash: string, candidate: string): Promise<boolean> {
    if (!isVerifiableHash(storedHash)) {
      return false;
    }

    try {
      return await argon2Verify(storedHash, candidate);
    } catch {
      return false;
    }
  }

  /**
   * Performs the same work as a real verification for an identifier that does not
   * exist, so an unknown identifier cannot be detected by a faster response. The
   * throwaway hash is computed once per process with the configured cost and is not a
   * credential: it protects no account.
   */
  public async verifyAgainstDummyHash(candidate: string): Promise<boolean> {
    this.dummyHash ??= await this.hash(randomDummySecret());

    return this.verify(this.dummyHash, candidate);
  }

  /** True when a stored hash is weaker than the configured parameters. */
  public needsRehash(storedHash: string): boolean {
    if (!isVerifiableHash(storedHash)) {
      return false;
    }

    const configured = this.parameters;
    const parsed = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);

    if (parsed === null) {
      return true;
    }

    return (
      Number.parseInt(parsed[1] ?? '0', 10) < configured.memoryKib ||
      Number.parseInt(parsed[2] ?? '0', 10) < configured.iterations ||
      Number.parseInt(parsed[3] ?? '0', 10) < configured.parallelism
    );
  }

  private get parameters(): Argon2Parameters {
    return getAppEnvironment(this.config).auth.argon2;
  }
}

function toArgon2Cost(parameters: Argon2Parameters): {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
} {
  return {
    memoryCost: parameters.memoryKib,
    timeCost: parameters.iterations,
    parallelism: parameters.parallelism,
  };
}

function isVerifiableHash(value: string): boolean {
  return value.startsWith('$argon2id$') && value.length > 30;
}

function randomDummySecret(): string {
  return `hyssop-dummy-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
