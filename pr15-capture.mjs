// Visual evidence capture for PR #75 (caption presets) at the merged head.
// Flow: API key -> voiceover upload -> clip upload -> Auto-Align (full) ->
// open panel Captions tab -> enable live preview -> screenshot per preset.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/home/user/work/evidence';
const apiKey = process.env.GEMINI_KEY || process.env.SECRET_GEMINI_API_KEY;
if (!apiKey) { console.error('FAIL: no GEMINI key in env'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE error:', m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('input[type="password"]').fill(apiKey);
await page.getByRole('button', { name: /save/i }).click();

// 1. Onboarding step 1: add the video clip in the modal, then Continue
await page.setInputFiles('input[type="file"] >> nth=0', '/tmp/syncro-e2e/test-clip.webm');
await page.waitForSelector('.fixed.inset-0 >> text=test-clip.webm', { timeout: 30000 });
await page.getByRole('button', { name: /Continue/ }).click();
// 2. Onboarding step 2: pick "Upload audio", then upload the voiceover
await page.getByText('Upload audio').click();
await page.setInputFiles('input[type="file"] >> nth=0', '/tmp/syncro-e2e/voiceover.wav');
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Auto-Align'));
  return b && !b.disabled;
}, { timeout: 60000 });
console.log('Voiceover + clip ready, editor visible, align enabled');
const alignButton = page.getByRole('button', { name: 'Auto-Align with AI' });
await alignButton.click();
console.log('alignment started');
// Wait for the ENTIRE align flow to finish — late state updates re-render the panel
// and reset its active tab, so interact only after the button re-enables
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Auto-Align'));
  return b && !b.disabled;
}, { timeout: 180000 });
console.log('alignment fully complete');

// 3. Open the post-processing panel on the Captions tab
await page.getByRole('button', { name: 'Export', exact: true }).click();
await page.getByRole('button', { name: 'Captions' }).click();
await page.waitForSelector('text=Presets', { timeout: 60000 });
await page.waitForSelector('text=Live Caption Preview', { timeout: 15000 });
console.log('Segments ready, Captions tab open');

// 4. Enable the live caption preview overlay (button is a sibling of the text block)
const toggle = page.getByText('Live Caption Preview', { exact: true })
  .locator('xpath=ancestor::div[1]/following-sibling::button[1]');
await toggle.click({ timeout: 15000 });
await page.waitForTimeout(600);

// 5. Classic is the default style; capture it first as the before state
await page.screenshot({ path: `${OUT}/pr15-before-classic.png` });
console.log('captured: before-classic');

// 6. Apply each preset and capture
for (const [label, file] of [['Bold Pop', 'pr15-after-boldpop.png'], ['Karaoke', 'pr15-result-karaoke.png'], ['Minimal', 'pr15-result-minimal.png']]) {
  await page.getByRole('button', { name: new RegExp(label) }).click();
  await page.waitForTimeout(600); // let the overlay re-render
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`captured: ${file}`);
}

await browser.close();
console.log('CAPTURES DONE');
