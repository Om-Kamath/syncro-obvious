import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Fixed timeline popovers (transition picker, alternatives) must stay inside
 * the viewport when their anchor sits near a window edge — fixed positioning
 * escapes the scroll container but not the window itself.
 */

const fixture = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);

test.use({ viewport: { width: 1440, height: 900 } });

test('transition picker stays fully visible when opened at the timeline right edge', async ({ page }) => {
  await page.goto('/');

  // Fresh context: forced API-key modal first.
  await page.getByPlaceholder('AIza…').fill('smoke-test-key');
  await page.getByRole('button', { name: 'Save Key' }).click();
  await expect(page.getByRole('heading', { name: 'Gemini API Key' })).toBeHidden();

  // Two valid 5s clips so zooming spreads the A|B boundary across pixels.
  const onboardingModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Upload your videos' });
  await onboardingModal.locator('input[type="file"]').setInputFiles([fixture('clip-a.webm'), fixture('clip-b.webm')]);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Skip — I'll add audio later" }).click();

  // The wizard exits through an AnimatePresence animation and stays
  // hit-testable for a few hundred ms — wait until a clip is the real
  // hit target at its own center before any mouse work.
  await page.waitForFunction(() => {
    const clips = document.querySelectorAll('[data-clip]');
    if (!clips.length) return false;
    const r = clips[clips.length - 1].getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!el && !!el.closest('[data-clip]');
  });

  // Both clips start at t=0 and overlap; clip B renders on top. Drag B so
  // its left edge lands exactly at clip A's right edge.
  const clips = page.locator('[data-clip]');
  await expect(clips).toHaveCount(2);
  const boxA = await clips.nth(0).boundingBox();
  const boxB = await clips.nth(1).boundingBox();
  expect(boxA).toBeTruthy();
  expect(boxB).toBeTruthy();

  // Zoom fully in so clip boundaries are far apart in pixels.
  const zoomIn = page.getByRole('button', { name: 'Zoom in timeline' });
  for (let i = 0; i < 15; i++) {
    if (await zoomIn.isDisabled()) break;
    await zoomIn.click();
  }

  const a = (await clips.nth(0).boundingBox())!;
  const b = (await clips.nth(1).boundingBox())!;
  const targetLeft = a.x + a.width;
  const startX = b.x + b.width / 2;
  const startY = b.y + b.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX + (targetLeft + b.width / 2 - startX) * (i / 10), startY);
  }
  await page.mouse.up();

  const afterA = (await clips.nth(0).boundingBox())!;
  const afterB = (await clips.nth(1).boundingBox())!;
  expect(Math.abs(afterB.x - (afterA.x + afterA.width))).toBeLessThan(2);

  // Scroll the A|B transition badge until it sits ~12px inside the scroll
  // area's right edge, then open the picker from it.
  const badge = page.getByRole('button', { name: /Edit transition into next clip/ });
  await expect(badge).toHaveCount(1);
  await page.evaluate(() => {
    const badgeEl = document.querySelector('button[aria-label^="Edit transition"]')!;
    const scroller = badgeEl.closest('.overflow-x-auto') as HTMLElement;
    const area = scroller.getBoundingClientRect();
    const rect = badgeEl.getBoundingClientRect();
    const badgeContentX = rect.right - area.left + scroller.scrollLeft;
    const desired = badgeContentX - (area.width - 12);
    scroller.scrollLeft = Math.max(0, Math.min(desired, scroller.scrollWidth - scroller.clientWidth));
  });
  await badge.click();

  const picker = page.locator('div.fixed.z-50').filter({ hasText: 'Transition' });
  await expect(picker).toBeVisible();

  // The fix: the measured panel is shifted back inside with an 8px margin.
  const geo = await picker.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight };
  });
  expect(geo.right).toBeLessThanOrEqual(geo.vw - 7.5);
  expect(geo.left).toBeGreaterThanOrEqual(-0.5);
  expect(geo.bottom).toBeLessThanOrEqual(geo.vh - 7.5);
  expect(geo.top).toBeGreaterThanOrEqual(-0.5);

  // The picker must be usable, not just visible: choose Fade and observe
  // the badge update.
  await picker.getByRole('button', { name: /Fade/ }).click();
  await expect(page.getByRole('button', { name: /Edit transition into next clip \(currently fade\)/ })).toBeVisible();
});
