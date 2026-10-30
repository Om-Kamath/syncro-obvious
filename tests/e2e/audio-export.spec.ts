import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Audio-only WAV export coverage for the Export tab:
 * - a valid voiceover yields a real WAV download with a canonical RIFF header
 * - sources with no decodable audio surface an inline error instead of silence
 */

const DUMMY_VIDEO = {
  name: 'smoke-clip.mp4',
  mimeType: 'video/mp4',
  // Invalid media bytes: the app tolerates unplayable clips (duration 0),
  // and the mixdown reports them as skipped — perfect for the error path.
  buffer: Buffer.from('smoke-test-placeholder-bytes'),
};

const VOICEOVER_WAV = {
  name: 'voiceover.wav',
  mimeType: 'audio/wav',
  buffer: makeWavBuffer(),
};

/** Build a valid 16-bit PCM WAV (0.5 s, 8 kHz mono sine) decodable by Chromium. */
function makeWavBuffer(sampleRate = 8000, seconds = 0.5): Buffer {
  const numFrames = Math.floor(sampleRate * seconds);
  const dataSize = numFrames * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numFrames; i++) {
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), 44 + i * 2);
  }
  return wav;
}

async function openExportTab(page: Page, withVoiceover: boolean) {
  await page.goto('/');
  await page.getByPlaceholder('AIza…').fill('smoke-test-key');
  await page.getByRole('button', { name: 'Save Key' }).click();

  // Onboarding step 1: a clip is required before Continue unlocks.
  const onboardingModal = page
    .locator('div.fixed.inset-0')
    .filter({ hasText: 'Upload your videos' });
  await onboardingModal.locator('input[type="file"]').setInputFiles([DUMMY_VIDEO]);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Onboarding step 2: upload the voiceover or skip it.
  if (withVoiceover) {
    await page.getByText('Upload audio').click();
    const step2 = page.locator('div.fixed.inset-0').filter({ hasText: 'Add a voiceover' });
    await step2.locator('input[type="file"]').setInputFiles([VOICEOVER_WAV]);
  } else {
    await page.getByRole('button', { name: "Skip — I'll add audio later" }).click();
  }
  await expect(page.getByText('Add a voiceover')).toBeHidden();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const panel = page.locator('.fixed.inset-0');
  await expect(panel.getByText('Export & Post-Processing')).toBeVisible();
  await panel.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(panel.getByText('Export Mixed Audio (WAV)')).toBeVisible();
  return panel;
}

test.describe('Syncro audio-only WAV export', () => {
  test('downloads the mixed track as a valid WAV file', async ({ page }) => {
    const panel = await openExportTab(page, true);

    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Export WAV' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('syncvoice-mixdown.wav');
    const path = await download.path();
    const wav = fs.readFileSync(path!);

    // Canonical 44-byte PCM header wrapping ~0.5 s of 44.1 kHz stereo audio.
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(2); // stereo
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    const dataSize = wav.readUInt32LE(40);
    expect(dataSize).toBeGreaterThan(0.4 * 44100 * 4); // at least 0.4 s of audio
    expect(wav.length).toBe(44 + dataSize);

    // The undecodable dummy clip is reported, not silently dropped.
    await expect(panel.getByText(/Skipped sources \(no audio\): smoke-clip\.mp4/)).toBeVisible();
  });

  test('surfaces an inline error when nothing is decodable', async ({ page }) => {
    const panel = await openExportTab(page, false);

    await panel.getByRole('button', { name: 'Export WAV' }).click();
    await expect(panel.getByText(/Export failed — no sources produced audio\. Skipped: smoke-clip\.mp4/)).toBeVisible();
    // Recovery: the button stays enabled for a retry.
    await expect(panel.getByRole('button', { name: 'Export WAV' })).toBeEnabled();
  });
});
