/**
 * PR 29 visual + behavioral verification (NOT committed).
 * Drives the real UI against the local dev servers:
 *   save-with-media -> reload -> open -> clips playable -> missing-blob error states.
 */
import { chromium } from '@playwright/test';
import { readdirSync, existsSync, rmSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const MEDIA_DIR = '/home/user/work/syncro-obvious/data/media';
const CLIP = '/home/user/work/evidence-pr29/pr29-clip.mp4';
const OUT = '/home/user/work/evidence-pr29';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };

const clipBlock = page.locator('[aria-label^="Clip:"]');

/** The Projects button only renders past onboarding; the wizard needs >=1 clip to proceed. */
async function reachEditor() {
  await page.locator('input[type=file]').first().setInputFiles(CLIP);
  await clipBlock.first().waitFor({ state: 'visible', timeout: 30000 });
  for (let i = 0; i < 3; i++) {
    const next = page.getByRole('button', { name: /Continue|Skip|Finish/ }).first();
    if (!(await next.count())) break;
    if (!(await next.isEnabled())) break;
    await next.click({ force: true });
    await page.waitForTimeout(400);
  }
  await clipBlock.first().waitFor({ state: 'visible', timeout: 30000 });
}

// Fresh origin state: seed the API key so the key modal never blocks.
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => localStorage.setItem('syncro_gemini_api_key', 'test-key-for-ui-verification'));
await page.reload();
await page.waitForLoadState('networkidle');

// --- 1. Upload a clip, reach the editor, save with media ---
await reachEditor();
const clipLabel = await clipBlock.first().getAttribute('aria-label');
console.log('clip on timeline:', clipLabel);
if (!clipLabel?.includes('pr29-clip')) fail('uploaded clip did not appear on the timeline');

await page.getByRole('button', { name: 'Projects' }).click();
await page.getByPlaceholder('Project name').fill('PR29 Roundtrip');
await page.getByRole('button', { name: 'Save', exact: true }).click();
const savedRow = page.locator('li', { hasText: 'PR29 Roundtrip' });
await savedRow.waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/pr29-tc1-saved-project-listed.png` });
console.log('tc1: project listed in the save/open modal');

// Record must reference persisted media; server must hold the bytes.
const record = await page.evaluate(() => JSON.parse(localStorage.getItem('syncro_saved_projects_v1'))[0]);
console.log('saved record:', JSON.stringify({ id: record.id, clipMediaIds: record.project.clips.map(c => c.mediaId), voiceoverMediaId: record.project.voiceover?.mediaId ?? null }));
if (!record.project.clips.every(c => c.mediaId)) fail('a saved clip has no mediaId');
const storedMedia = existsSync(MEDIA_DIR) ? readdirSync(MEDIA_DIR) : [];
console.log('server media dirs:', storedMedia.length);
if (storedMedia.length !== record.project.clips.length + (record.project.voiceover ? 1 : 0)) fail('server media store count mismatch');

// --- 2. Full reload (blob URLs die), then open the project ---
await page.reload();
await page.waitForLoadState('networkidle');
await clipBlock.first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
await reachEditor();
await page.getByRole('button', { name: 'Projects' }).click();
await savedRow.getByRole('button', { name: 'Open' }).click();
await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 30000 });
await clipBlock.first().waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(1500); // let the <video> element settle
await page.screenshot({ path: `${OUT}/pr29-tc2-restored-playable.png` });

const videos = await page.evaluate(() =>
  [...document.querySelectorAll('video')].map(v => ({ src: v.src.slice(0, 12), duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : v.duration, readyState: v.readyState })),
);
console.log('restored video elements:', JSON.stringify(videos));
const playable = videos.some(v => v.src.startsWith('blob:') && v.duration > 0 && v.readyState >= 1);
if (!playable) fail('no restored clip video is playable (no blob src with metadata)');
const banner = page.locator('[role="alert"]');
if (await banner.count()) fail('restore banner appeared although all media was restored');
console.log('tc2: project restored after reload, clip playable, no error banner');

// --- 3. Missing-blob case: wipe the server media, reload, open ---
rmSync(MEDIA_DIR, { recursive: true, force: true });
await page.reload();
await page.waitForLoadState('networkidle');
await reachEditor();
await page.getByRole('button', { name: 'Projects' }).click();
await savedRow.getByRole('button', { name: 'Open' }).click();
await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 30000 });
const alert = page.locator('[role="alert"]');
await alert.waitFor({ state: 'visible', timeout: 15000 });
const alertText = await alert.textContent();
console.log('restore banner:', alertText?.slice(0, 140));
if (!alertText?.includes('no longer exists')) fail('banner did not explain the missing media');
const badge = page.locator('[aria-label*="media missing"]');
if (!(await badge.count())) fail('timeline clip does not carry the media-missing state');
await page.screenshot({ path: `${OUT}/pr29-tc3-missing-media-states.png` });
console.log('tc3: missing blob -> banner + per-clip error state, load did not crash');

await browser.close();
console.log(process.exitCode ? 'RESULT: FAILURES' : 'RESULT: ALL VERIFIED');
