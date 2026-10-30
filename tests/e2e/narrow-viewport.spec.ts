import { expect, test } from '@playwright/test';
import { openEditorShell } from './support';

/**
 * Narrow-viewport regression guard: at phone widths the editor shell and the
 * export panel must not force horizontal document scroll. The header action
 * row (time, Logs, + New Project, key, Export) is the widest in-flow row, so
 * it is the element this guard pins.
 */

test.describe('narrow viewport layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('no horizontal document scroll at 375px, editor shell and export panel', async ({ page }) => {
    await openEditorShell(page);

    const hasNoHorizontalScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    // Editor shell with a clip loaded: header row must fit the viewport.
    expect(await hasNoHorizontalScroll()).toBe(true);
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();

    // Export panel open on the Export tab — the densest panel content.
    await page.getByRole('button', { name: 'Export' }).click();
    const panel = page.locator('.fixed.inset-0');
    await expect(panel.getByText('Export & Post-Processing')).toBeVisible();
    await panel.getByRole('button', { name: 'Export', exact: true }).click();
    await page.waitForTimeout(500); // drawer spring animation settles
    expect(await hasNoHorizontalScroll()).toBe(true);
  });
});
