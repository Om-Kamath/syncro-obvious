import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const DIR = '/home/user/work/evidence';
const apiKey = process.env.GEMINI_KEY;
if (!apiKey) throw new Error('GEMINI_KEY missing');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('input[type="password"]').fill(apiKey);
await page.getByRole('button', { name: /save/i }).click();

// Onboarding step 1: add the video clip in the modal, then Continue
await page.setInputFiles('input[type="file"] >> nth=0', '/tmp/syncro-e2e/test-clip.webm');
await page.waitForSelector('.fixed.inset-0 >> text=test-clip.webm', { timeout: 30000 });
await page.getByRole('button', { name: /Continue/ }).click();
// Onboarding step 2: pick "Upload audio", then upload the voiceover
await page.getByText('Upload audio').click();
await page.setInputFiles('input[type="file"] >> nth=0', '/tmp/syncro-e2e/voiceover.wav');
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Auto-Align'));
  return b && !b.disabled;
}, undefined, { timeout: 60000 });
console.log('Voiceover + clip ready, editor visible, align enabled');
const alignButton = page.getByRole('button', { name: 'Auto-Align with AI' });
await alignButton.click();
console.log('alignment started');
// Wait for the ENTIRE align flow to finish — late state updates re-render the panel
// and reset its active tab, so interact only after the button re-enables
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Auto-Align'));
  return b && !b.disabled;
}, undefined, { timeout: 180000 });
console.log('alignment fully complete');

// Open the post-processing panel on the Captions tab
await page.getByRole('button', { name: 'Export', exact: true }).click();
await page.getByRole('button', { name: 'Captions' }).click();
await page.waitForSelector('text=Presets', { timeout: 60000 });
await page.waitForSelector('text=Live Caption Preview', { timeout: 15000 });

async function ensureCaptions() {
  const on = await page.evaluate(() => {
    const sw = document.querySelector('[role="switch"]');
    return sw ? sw.getAttribute('aria-checked') === 'true' : false;
  });
  if (!on) await page.locator('[role="switch"]').first().click();
}
await ensureCaptions();

async function clickPreset(name) {
  const card = page.locator('button', { hasText: name }).last();
  await card.click();
  await page.waitForTimeout(600); // style propagation + paint settle
}

await page.screenshot({ path: `${DIR}/pr15-before-classic.png` });
console.log('captured: before-classic');
await clickPreset('Bold Pop');
await page.screenshot({ path: `${DIR}/pr15-after-boldpop.png` });
console.log('captured: pr15-after-boldpop.png');
await clickPreset('Karaoke');
await page.screenshot({ path: `${DIR}/pr15-result-karaoke.png` });
console.log('captured: pr15-result-karaoke.png');
await clickPreset('Minimal');
await page.screenshot({ path: `${DIR}/pr15-result-minimal.png` });
console.log('captured: pr15-result-minimal.png');
console.log('CAPTURES DONE');
await browser.close();
