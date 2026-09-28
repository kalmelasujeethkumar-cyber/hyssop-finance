import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedSession } from './session.service';

/**
 * Route opt-out from session authentication.
 *
 * Authority: `docs/06-API-SPEC.md` — only `GET /api/v1/health` and the authentication
 * routes themselves are reachable without a session. Every other route is protected by
 * default, so a new controller is secure unless someone deliberately marks it public.
 */
export const IS_PUBLIC_ROUTE = 'hyssop:public-route';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_ROUTE, true);

/** Injects the session the guard resolved, for controllers that need its identity. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { session?: AuthenticatedSession }>();

    if (request.session === undefined) {
      throw new Error('CurrentSession used on a route that is not protected by SessionGuard');
    }

    return request.session;
  },
);
