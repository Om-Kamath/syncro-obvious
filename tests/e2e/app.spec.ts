import { expect, test } from '@playwright/test';
import { openEditorShell } from './support';

/**
 * Smoke coverage for the shortest path through Syncro's front doors:
 * - the app boots and its header renders
 * - the forced API-key modal appears for fresh browsers
 * - the export panel's main tabs render after onboarding is skipped
 */

test.describe('Syncro app smoke', () => {
  test('app loads and the forced API key modal renders', async ({ page }) => {
    await page.goto('/');

    // Header is always mounted.
    await expect(page.getByRole('heading', { name: 'Syncro' })).toBeVisible();
    await expect(page.getByText('Video Editing Copilot')).toBeVisible();

    // A fresh browser context has no stored key, so the API key modal is forced.
    await expect(page.getByRole('heading', { name: 'Gemini API Key' })).toBeVisible();
    await expect(page.getByPlaceholder('AIza…')).toBeVisible();
  });

  test('main export tabs render after onboarding is skipped', async ({ page }) => {
    await openEditorShell(page);

    // Open the export panel and confirm every main tab renders.
    await page.getByRole('button', { name: 'Export' }).click();
    const panel = page.locator('.fixed.inset-0');
    await expect(panel.getByText('Export & Post-Processing')).toBeVisible();
    for (const tab of ['Description', 'Captions', 'Thumbnails', 'Export']) {
      await expect(panel.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }
  });
});
