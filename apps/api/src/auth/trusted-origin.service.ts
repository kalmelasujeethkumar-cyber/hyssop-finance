import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { getAppEnvironment } from '../config/environment';
import { resolveTrustedOrigin } from './request-origin';

@Injectable()
export class TrustedOriginService {
  public constructor(private readonly config: ConfigService) {}

  /** Resolves the request's trusted origin, or throws `FORBIDDEN`. */
  public resolve(request: Request): string {
    return resolveTrustedOrigin(request.headers, this.allowedOrigins());
  }

  /**
   * Enforces the trusted origin without using the value. For state-changing routes that
   * need no origin of their own, the check is still required: a cross-site request must
   * be refused by the server, not merely have its response withheld by the browser.
   */
  public assertTrusted(request: Request): void {
    this.resolve(request);
  }

  private allowedOrigins(): readonly string[] {
    return getAppEnvironment(this.config).corsAllowedOrigins;
  }
}
