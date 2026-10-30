import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for the shortest path through Syncro's front doors:
 * - the app boots and its header renders
 * - the forced API-key modal appears for fresh browsers
 * - the export panel's main tabs render after onboarding is skipped
 */

const DUMMY_VIDEO = {
  name: 'smoke-clip.mp4',
  mimeType: 'video/mp4',
  // Invalid media bytes are fine: the app resolves duration to 0 for
  // unplayable files, which is enough to enable onboarding's Continue.
  buffer: Buffer.from('smoke-test-placeholder-bytes'),
};

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
    await page.goto('/');

    // Dismiss the forced API key modal with a placeholder key.
    await page.getByPlaceholder('AIza…').fill('smoke-test-key');
    await page.getByRole('button', { name: 'Save Key' }).click();
    await expect(page.getByRole('heading', { name: 'Gemini API Key' })).toBeHidden();

    // Onboarding step 1 requires at least one clip before Continue unlocks.
    // Two file inputs exist (onboarding + editor behind it); scope to the modal.
    const onboardingModal = page
      .locator('div.fixed.inset-0')
      .filter({ hasText: 'Upload your videos' });
    const videoInput = onboardingModal.locator('input[type="file"]');
    await videoInput.setInputFiles([DUMMY_VIDEO]);
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    // Onboarding step 2 offers the skip path.
    await page.getByRole('button', { name: "Skip — I'll add audio later" }).click();
    await expect(page.getByText('Upload your videos')).toBeHidden();

    // Open the export panel and confirm every main tab renders.
    await page.getByRole('button', { name: 'Export' }).click();
    const panel = page.locator('.fixed.inset-0');
    await expect(panel.getByText('Export & Post-Processing')).toBeVisible();
    for (const tab of ['Description', 'Captions', 'Thumbnails', 'Export']) {
      await expect(panel.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }
  });
});
