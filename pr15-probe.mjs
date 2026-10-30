// One-shot DOM probe: where do the two file inputs live, and what surface is on top?
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.locator('input[type="password"]').fill('test-key-not-used');
await page.getByRole('button', { name: /save/i }).click();
await page.waitForTimeout(800);

const probe = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[type=file]')];
  return inputs.map((inp, i) => {
    let el = inp, chain = [];
    for (let d = 0; d < 6 && el.parentElement; d++) {
      el = el.parentElement;
      const label = el.querySelector('p');
      chain.push(el.className.slice(0, 60) + (label ? ` | p:"${label.textContent?.slice(0, 40)}"` : ''));
    }
    return { i, visible: !!(inp.offsetParent), chain };
  });
});
console.log(JSON.stringify(probe, null, 2));

// Upload the wav into the FIRST input and see what happens
await page.setInputFiles('input[type="file"] >> nth=0', '/tmp/syncro-e2e/voiceover.wav');
await page.waitForTimeout(2500);
const after = await page.evaluate(() => ({
  modalVisible: !!document.querySelector('.fixed.inset-0'),
  modalText: document.querySelector('.fixed.inset-0')?.textContent?.slice(0, 200) || null,
  editorVisible: [...document.querySelectorAll('button')].some(b => b.textContent?.includes('Auto-Align')),
}));
console.log('after wav:', JSON.stringify(after, null, 2));
await page.screenshot({ path: '/home/user/work/evidence/pr15-probe.png' });
await browser.close();
