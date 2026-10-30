import { expect, type Page } from '@playwright/test';

/**
 * Shared e2e helpers: fixture media and the deterministic path from a fresh
 * browser context to the main editor shell (past the forced API-key modal
 * and onboarding).
 */

export const DUMMY_VIDEO = {
  name: 'smoke-clip.mp4',
  mimeType: 'video/mp4',
  // Invalid media bytes are fine: the app resolves duration to 0 for
  // unplayable files, which is enough to enable onboarding's Continue.
  buffer: Buffer.from('smoke-test-placeholder-bytes'),
};

/**
 * Dismiss the forced API-key modal with a placeholder key, then skip
 * onboarding with one dummy clip loaded, leaving the editor shell front-most.
 */
export async function openEditorShell(page: Page): Promise<void> {
  await page.goto('/');

  // A fresh browser context has no stored key, so the API key modal is forced.
  await page.getByPlaceholder('AIza…').fill('smoke-test-key');
  await page.getByRole('button', { name: 'Save Key' }).click();
  await expect(page.getByRole('heading', { name: 'Gemini API Key' })).toBeHidden();

  // Onboarding step 1 requires at least one clip before Continue unlocks.
  // Two file inputs exist (onboarding + editor behind it); scope to the modal.
  const onboardingModal = page
    .locator('div.fixed.inset-0')
    .filter({ hasText: 'Upload your videos' });
  await onboardingModal.locator('input[type="file"]').setInputFiles([DUMMY_VIDEO]);
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  // Onboarding step 2 offers the skip path.
  await page.getByRole('button', { name: "Skip — I'll add audio later" }).click();
  await expect(page.getByText('Upload your videos')).toBeHidden();
}
