import { describe, it, expect } from 'vitest';
import { partitionDroppedFiles } from './mediaImport';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('partitionDroppedFiles', () => {
  it('routes video, audio, and image files by MIME type', () => {
    const mp4 = file('clip.mp4', 'video/mp4');
    const mp3 = file('voice.mp3', 'audio/mpeg');
    const png = file('thumb.png', 'image/png');

    const result = partitionDroppedFiles([mp4, mp3, png]);

    expect(result.videos).toEqual([mp4]);
    expect(result.audios).toEqual([mp3]);
    expect(result.images).toEqual([png]);
    expect(result.rejected).toEqual([]);
  });

  it('rejects files outside the supported type families', () => {
    const pdf = file('deck.pdf', 'application/pdf');
    const zip = file('archive.zip', 'application/zip');

    const result = partitionDroppedFiles([pdf, zip]);

    expect(result.rejected).toEqual([pdf, zip]);
    expect(result.videos).toEqual([]);
    expect(result.audios).toEqual([]);
    expect(result.images).toEqual([]);
  });

  it('rejects files with an unknown or empty MIME type', () => {
    const noType = file('mystery', '');

    const result = partitionDroppedFiles([noType]);

    expect(result.rejected).toEqual([noType]);
  });

  it('is case-insensitive on MIME type', () => {
    const odd = file('clip.MOV', 'VIDEO/QuickTime');

    expect(partitionDroppedFiles([odd]).videos).toEqual([odd]);
  });

  it('returns empty partitions for an empty drop', () => {
    expect(partitionDroppedFiles([])).toEqual({ videos: [], audios: [], images: [], rejected: [] });
  });
});
