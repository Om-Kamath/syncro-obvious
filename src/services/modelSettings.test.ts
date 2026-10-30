// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getModelSettings, setModelSettings, validateModelSettings } from './modelSettings';
import type { ModelSettings } from './models';

const STORED_KEY = 'syncro_model_settings';

beforeEach(() => {
  localStorage.clear();
});

describe('validateModelSettings', () => {
  it('accepts valid settings untouched', () => {
    const settings: ModelSettings = { defaultTier: 'pro', overrides: { transcription: 'flash' } };
    expect(validateModelSettings(settings)).toEqual(settings);
  });

  it('drops unknown tiers and unknown operations', () => {
    expect(validateModelSettings({ defaultTier: 'turbo', overrides: { transcription: 'pro', bogus: 'flash' } }))
      .toEqual({ overrides: { transcription: 'pro' } });
  });

  it('returns empty settings for non-object input', () => {
    expect(validateModelSettings(null)).toEqual({});
    expect(validateModelSettings('pro')).toEqual({});
    expect(validateModelSettings(42)).toEqual({});
  });
});

describe('modelSettings store', () => {
  it('returns empty settings when nothing is stored', () => {
    expect(getModelSettings()).toEqual({});
  });

  it('round-trips settings through localStorage', () => {
    const settings: ModelSettings = {
      defaultTier: 'pro',
      overrides: { transcription: 'flash', description: 'flashLite' },
    };
    setModelSettings(settings);
    expect(getModelSettings()).toEqual(settings);
  });

  it('removes the stored key when settings are emptied', () => {
    setModelSettings({ defaultTier: 'pro' });
    setModelSettings({});
    expect(localStorage.getItem(STORED_KEY)).toBeNull();
    expect(getModelSettings()).toEqual({});
  });

  it('discards a corrupt stored blob and resets to the registry baseline', () => {
    localStorage.setItem(STORED_KEY, '{not valid json');
    expect(getModelSettings()).toEqual({});
    expect(localStorage.getItem(STORED_KEY)).toBeNull();
  });

  it('sanitizes malformed stored settings instead of passing them through', () => {
    localStorage.setItem(STORED_KEY, JSON.stringify({ defaultTier: 'turbo', overrides: { clipAlignment: 'pro', nope: 'x' } }));
    expect(getModelSettings()).toEqual({ overrides: { clipAlignment: 'pro' } });
  });
});
