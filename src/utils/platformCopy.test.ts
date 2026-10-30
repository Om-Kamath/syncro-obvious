import { describe, it, expect } from 'vitest';
import {
  buildPlatformCopy,
  buildFullDescriptionText,
  buildPublishPackageText,
  formatChapterLines,
} from './platformCopy';
import { PLATFORM_PRESETS } from './platformPresets';
import type { VideoDescription } from '../types';

const description: VideoDescription = {
  summary: 'A quick tour of Syncro.',
  chapters: [
    { time: 0, label: 'Intro' },
    { time: 65, label: 'Deep dive' },
  ],
  hashtags: ['aivideo', 'syncro', 'editing'],
};

describe('formatChapterLines', () => {
  it('formats chapters as YouTube timestamp lines', () => {
    expect(formatChapterLines(description.chapters)).toBe('0:00 Intro\n1:05 Deep dive');
  });

  it('switches to hour precision past one hour', () => {
    expect(formatChapterLines([{ time: 3661, label: 'Finale' }])).toBe('1:01:01 Finale');
  });

  it('returns an empty string for no chapters', () => {
    expect(formatChapterLines([])).toBe('');
  });
});

describe('buildPlatformCopy', () => {
  it('exposes the four platform presets', () => {
    expect(Object.keys(PLATFORM_PRESETS)).toEqual(['youtube', 'shorts', 'tiktok', 'instagram']);
  });

  it('youtube keeps title, summary, chapters, and all hashtags', () => {
    const out = buildPlatformCopy('youtube', { title: 'My Video', description });
    expect(out).toBe(
      'My Video\n\nA quick tour of Syncro.\n\n0:00 Intro\n1:05 Deep dive\n\n#aivideo #syncro #editing'
    );
  });

  it('shorts appends #Shorts to the title and caps hashtags at five', () => {
    const manyTags: VideoDescription = {
      ...description,
      hashtags: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
    };
    const out = buildPlatformCopy('shorts', { title: 'My Video', description: manyTags });
    expect(out).toContain('My Video #Shorts');
    const tags = out.match(/#\w+/g) ?? [];
    expect(tags).toEqual(['#Shorts', '#one', '#two', '#three', '#four', '#five']);
  });

  it('tiktok drops the title and stays short', () => {
    const out = buildPlatformCopy('tiktok', { title: 'My Video', description });
    expect(out).not.toContain('My Video');
    expect(out).not.toContain('0:00 Intro');
    expect(out).toBe('A quick tour of Syncro.\n\n#aivideo #syncro #editing');
  });

  it('instagram pairs the summary with the full hashtag block', () => {
    const out = buildPlatformCopy('instagram', { title: 'My Video', description });
    expect(out).not.toContain('My Video');
    expect(out).toBe('A quick tour of Syncro.\n\n#aivideo #syncro #editing');
  });

  it('falls back to an empty string with no description and no title', () => {
    expect(buildPlatformCopy('youtube', { title: '', description: null })).toBe('');
  });

  it('renders #Shorts even without a title', () => {
    const out = buildPlatformCopy('shorts', { title: '', description });
    expect(out.startsWith('#Shorts')).toBe(true);
  });
});

describe('buildFullDescriptionText', () => {
  it('joins summary, chapters, and hashtags', () => {
    expect(buildFullDescriptionText(description)).toBe(
      'A quick tour of Syncro.\n\n0:00 Intro\n1:05 Deep dive\n\n#aivideo #syncro #editing'
    );
  });

  it('returns an empty string for no description', () => {
    expect(buildFullDescriptionText(null)).toBe('');
  });
});

describe('buildPublishPackageText', () => {
  it('puts the chosen title on top of the full description', () => {
    expect(buildPublishPackageText({ title: 'My Video', description })).toBe(
      'My Video\n\nA quick tour of Syncro.\n\n0:00 Intro\n1:05 Deep dive\n\n#aivideo #syncro #editing'
    );
  });

  it('is just the description when no title is chosen', () => {
    expect(buildPublishPackageText({ title: '', description })).toBe(buildFullDescriptionText(description));
  });

  it('is an empty string with nothing to ship', () => {
    expect(buildPublishPackageText({ title: '', description: null })).toBe('');
  });
});
