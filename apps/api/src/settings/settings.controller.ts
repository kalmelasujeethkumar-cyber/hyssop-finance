import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Version,
} from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER, success, type DemoSettings } from '@hyssop/contracts';
import type { AuthenticatedSession } from '../auth/session.service';
import { CurrentRequestId, CurrentSession } from '../auth/auth.decorators';
import { readIdempotencyKey } from '../common/http/idempotency';
import { SetDefaultContributionDto, UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService, type SettingsActor } from './settings.service';

/**
 * The settings routes of `docs/06-API-SPEC.md` "Settings".
 *
 * Protected by the global `SessionGuard`: there is no `@Public()` here. A settings change is one of
 * the "important settings" actions `docs/07-SECURITY-RULES.md` requires to be attributable, which
 * means the write is attributed to an authenticated admin and is never reachable anonymously.
 *
 * Every mutation requires an `Idempotency-Key`, read through the shared
 * {@link readIdempotencyKey} helper rather than being read and defaulted locally. The returned
 * settings state is the stored response of that command, so a retry reports the state that was
 * actually saved instead of applying the change twice and reporting success.
 *
 * There is no route here that could reset the database (`REQ-SETTINGS-008`) or configure church
 * identity (`REQ-SETTINGS-001`), and none may be added: neither is part of this product.
 */
@Controller('settings')
export class SettingsController {
  public constructor(private readonly settings: SettingsService) {}

  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async read(): Promise<{ data: DemoSettings }> {
    return success(await this.settings.read());
  }

  /**
   * Updates the supplied settings.
   *
   * A partial body is valid and an omitted field is left alone, as documented. `200` rather than
   * `201`: nothing is created, and the response is the resulting settings state so the screen can
   * show what was stored instead of assuming its input was accepted.
   */
  @Patch()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async update(
    @Body() body: UpdateSettingsDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: DemoSettings }> {
    return success(
      await this.settings.update(body, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }

  /**
   * Sets the default monthly member expectation.
   *
   * `docs/06-API-SPEC.md` gives this its own address so the intent - "from now on, members are
   * expected to give this much" - is separately auditable from a general settings edit. It is a
   * `POST` rather than a `PATCH` because `docs/06-API-SPEC.md` documents it as one.
   */
  @Post('contribution-default')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async setDefaultContribution(
    @Body() body: SetDefaultContributionDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: DemoSettings }> {
    return success(
      await this.settings.setDefaultContribution(body, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }
}

function actorOf(session: AuthenticatedSession, requestId: string | null): SettingsActor {
  return { adminUserId: session.admin.id, requestId };
}
