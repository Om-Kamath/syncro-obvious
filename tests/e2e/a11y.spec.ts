import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';
import { openEditorShell } from './support';

/**
 * Automated accessibility checks (axe-core) over the surfaces a user always
 * touches: the main shell (with and without the forced API-key modal) and
 * each export-panel tab.
 *
 * The gate is axe's "critical" impact tier — those failures block assistive
 * technology outright. Lower-impact findings are logged for triage instead of
 * failing the build; they accumulate in the a11y backlog.
 */

/** Summarize a violation for readable assertion output and console triage. */
function summarize(violations: AxeResults['violations']): string {
  return JSON.stringify(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
    null,
    2,
  );
}

async function scan(page: Page): Promise<AxeResults> {
  return new AxeBuilder({ page }).analyze();
}

function expectNoCriticalViolations(result: AxeResults): void {
  const critical = result.violations.filter((v) => v.impact === 'critical');
  const nonCritical = result.violations.filter((v) => v.impact !== 'critical');

  // Lesser-impact findings stay visible for triage without failing the gate.
  if (nonCritical.length > 0) {
    console.log(`[a11y] non-critical violations:\n${summarize(nonCritical)}`);
  }

  expect(critical, `critical axe violations:\n${summarize(critical)}`).toEqual([]);
}

test.describe('a11y: axe-core checks', () => {
  test('fresh shell with forced API-key modal has no critical violations', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Gemini API Key' })).toBeVisible();

    expectNoCriticalViolations(await scan(page));
  });

  test('main editor shell has no critical violations', async ({ page }) => {
    await openEditorShell(page);
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();

    expectNoCriticalViolations(await scan(page));
  });

  for (const tab of ['Description', 'Captions', 'Thumbnails', 'Export']) {
    test(`export panel "${tab}" tab has no critical violations`, async ({ page }) => {
      await openEditorShell(page);
      await page.getByRole('button', { name: 'Export' }).click();
      const panel = page.locator('.fixed.inset-0');
      await expect(panel.getByText('Export & Post-Processing')).toBeVisible();
      await panel.getByRole('button', { name: tab, exact: true }).click();

      expectNoCriticalViolations(await scan(page));
    });
  }

  test('export panel has no color-contrast violations on any tab', async ({ page }) => {
    await openEditorShell(page);
    await page.getByRole('button', { name: 'Export' }).click();
    const panel = page.locator('.fixed.inset-0');
    await expect(panel.getByText('Export & Post-Processing')).toBeVisible();

    // Scoped to the panel overlay: the app shell behind it carries its own
    // pre-existing findings tracked separately.
    for (const tab of ['Description', 'Captions', 'Thumbnails', 'Export']) {
      await panel.getByRole('button', { name: tab, exact: true }).click();
      const result = await new AxeBuilder({ page }).include('.fixed.inset-0').analyze();
      const contrast = result.violations.filter((v) => v.id === 'color-contrast');
      expect(contrast, `color-contrast violations on "${tab}" tab:\n${summarize(contrast)}`).toEqual([]);
    }
  });
});
