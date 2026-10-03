import { expect, test, type Page } from '@playwright/test';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-RESP-002` for the application shell.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-RESP-002` (desktop sidebar), `REQ-RESP-003`
 * (collapsible sidebar and mobile drawer), `REQ-RESP-012`, and `REQ-RESP-013`; and
 * `docs/03-UI-UX-RULES.md`, which requires a desktop sidebar, a clear narrow-viewport drawer, a
 * current-section marker, and no page-level horizontal overflow.
 *
 * These run against the real preview build and a signed-in session. The viewports are set
 * explicitly because the Playwright project only defines Desktop Chrome; a test that inherited that
 * single size could not prove the narrow layouts at all. Playwright gives each test its own
 * browser context, so a collapsed-sidebar preference written by one test cannot leak into another.
 */

/** Signs in from a bare `/login`, which lands on the dashboard. */
async function openApp(page: Page): Promise<void> {
  await page.goto('/login');
  await signIn(page);
}

test('a wide viewport shows one desktop sidebar that collapses and remembers the choice', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);

  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await expect(navigation).toBeVisible();

  // The narrow-viewport toggle is not offered on a desktop, so there is only ever one navigation
  // to reach rather than a sidebar and a drawer that could disagree.
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();

  const collapse = page.getByRole('button', { name: 'Collapse navigation' });
  await expect(collapse).toBeVisible();
  await expect(collapse).toHaveAttribute('aria-pressed', 'false');

  await collapse.click();

  // Collapsing must not hide access: every section stays reachable, and the link keeps its
  // accessible name even though its visible text is now only a glyph.
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(navigation.getByRole('link', { name: 'Settings' })).toBeVisible();

  // The choice is a real preference, so it survives a reload rather than resetting each visit.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  expect(browserErrors).toEqual([]);
});

test('an iPhone-sized viewport uses a drawer that opens, moves focus, closes on Escape, and navigates', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);

  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await expect(navigation).toBeHidden();

  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toHaveAttribute('aria-controls', 'primary-navigation');

  await menu.click();

  await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(navigation).toBeVisible();
  // Focus moves into the drawer, so a keyboard user is not left behind on the page underneath.
  await expect(navigation.getByRole('link', { name: 'Dashboard' })).toBeFocused();
  // The page behind the drawer cannot scroll away under it.
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
  await expect(navigation).toBeHidden();

  // Choosing a section from the drawer both navigates and closes the drawer.
  await page.getByRole('button', { name: 'Menu' }).click();
  await navigation.getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  expect(browserErrors).toEqual([]);
});

test('no required viewport produces page-level horizontal overflow', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);

  // The documented target sizes: a small Android phone, an iPhone, a large phone, a tablet in both
  // orientations, a laptop, and a desktop. A layout must fit each without a sideways scrollbar.
  for (const width of [360, 390, 412, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    const overflowPixels = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    // A one-pixel tolerance absorbs sub-pixel rounding; a real overflow is many pixels.
    expect(overflowPixels, `dashboard horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }

  expect(browserErrors).toEqual([]);
});
