import { SetMetadata } from '@nestjs/common';
import type { RATE_LIMIT_OPT_OUT, RateLimitCategory } from './rate-limit.types';

export const RATE_LIMIT_CATEGORY = 'hyssop:rate-limit-category';

export type RateLimitMark = RateLimitCategory | typeof RATE_LIMIT_OPT_OUT;

/**
 * Assigns a route to one of the general request-abuse categories, or opts it out with `'none'`.
 *
 * A handler with no mark is limited as `mutation` when its method changes state and is not
 * limited at all when it is a `GET`/`HEAD`/`OPTIONS`. Search and export are reads, so they carry
 * an explicit mark rather than relying on the method default.
 */
export const RateLimit = (category: RateLimitMark): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_CATEGORY, category);
