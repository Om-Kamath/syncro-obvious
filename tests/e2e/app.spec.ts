import { expect, test } from '@playwright/test';
import { openEditorShell } from './support';

/**
 * Smoke coverage for the shortest path through Syncro's front doors:
 * - the app boots and its header renders
 * - the forced API-key modal appears for fresh browsers
 * - the export panel's main tabs render after onboarding is skipped
 * - global transport shortcuts drive the playhead from the app shell
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

  test('timeline transport shortcuts drive the playhead', async ({ page }) => {
    await page.goto('/');

    // Onboard to the editor with a placeholder clip and key.
    await page.getByPlaceholder('AIza…').fill('smoke-test-key');
    await page.getByRole('button', { name: 'Save Key' }).click();
    const onboardingModal = page
      .locator('div.fixed.inset-0')
      .filter({ hasText: 'Upload your videos' });
    await onboardingModal.locator('input[type="file"]').setInputFiles([DUMMY_VIDEO]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: "Skip — I'll add audio later" }).click();
    await expect(page.getByText('Upload your videos')).toBeHidden();

    // The skip button keeps focus through the modal's exit animation (~0.5s),
    // and "hidden" can pass for absent text. Global shortcuts only fire when
    // the app shell holds focus, so wait for exactly that precondition.
    await page.waitForFunction(() => document.activeElement === document.body);

    const playhead = page.getByRole('slider', { name: 'Playhead position' });

    // ArrowRight from the shell steps one frame (1/30s rounds to 0.03).
    await page.keyboard.press('ArrowRight');
    await expect(playhead).toHaveAttribute('aria-valuenow', '0.03');

    // L shuttles forward exactly 1s (0.0333 + 1 = 1.0333 → "1.03"), J back.
    await page.keyboard.press('l');
    await expect(playhead).toHaveAttribute('aria-valuenow', '1.03');
    await page.keyboard.press('j');
    await expect(playhead).toHaveAttribute('aria-valuenow', '0.03');

    // Space starts the clock, K pauses it — the toolbar label mirrors the state.
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause timeline' })).toBeVisible();
    await page.keyboard.press('k');
    await expect(page.getByRole('button', { name: 'Play timeline' })).toBeVisible();
  });
});
