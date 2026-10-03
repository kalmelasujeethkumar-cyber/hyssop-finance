/**
 * The request categories `docs/07-SECURITY-RULES.md` requires to be limited.
 *
 * Login is deliberately absent: it has its own pre-credential limiter (`DEC-066`) that must
 * reject a guess before any credential lookup, which a route-level guard cannot do. These four
 * are the categories the document names alongside login.
 */
export const RATE_LIMIT_CATEGORIES = ['mutation', 'search', 'upload', 'export'] as const;

export type RateLimitCategory = (typeof RATE_LIMIT_CATEGORIES)[number];

/**
 * A route opts out of the general limiter with `@RateLimit('none')`.
 *
 * It is needed only for the public state-changing authentication routes (`login`, `logout`):
 * `login` is already limited by the dedicated login limiter, and `logout` must stay reachable so a
 * browser holding a stale cookie can always sign out. Safe methods are never limited by default.
 */
export const RATE_LIMIT_OPT_OUT = 'none';
