import { describe, expect, it } from 'vitest';
import { buildTimelineSnapshot, type TimelineProjectState } from './timeline';

function project(overrides: Partial<TimelineProjectState> = {}): TimelineProjectState {
  return {
    id: 'proj-1',
    name: 'Launch teaser',
    clips: [
      { id: 'clip-a', name: 'intro.mp4', duration: 10, trimmedDuration: 4, trimStart: 2 },
      { id: 'clip-b', name: 'demo.mp4', duration: 8, track: 1, transitionIn: 'fade' },
      { id: 'clip-c', name: 'outro.mp4', duration: 6, textOverlay: 'Thanks for watching' },
    ],
    ...overrides,
  };
}

describe('buildTimelineSnapshot', () => {
  it('serializes clips in array order with chained start times', () => {
    const snapshot = buildTimelineSnapshot(project());

    expect(snapshot.clips.map((clip) => clip.order)).toEqual([0, 1, 2]);
    // effective durations: 4 (trimmed), 8, 6 → starts at 0, 4, 12
    expect(snapshot.clips.map((clip) => clip.startTime)).toEqual([0, 4, 12]);
    expect(snapshot.duration).toBe(18);
    expect(snapshot.clipCount).toBe(3);
  });

  it('reports effective and source durations separately for trimmed clips', () => {
    const snapshot = buildTimelineSnapshot(project());

    const trimmed = snapshot.clips[0];
    expect(trimmed).toMatchObject({
      id: 'clip-a',
      duration: 4,
      sourceDuration: 10,
      trimStart: 2,
    });
  });

  it('recomputes start times from array order even when stored startTimes are stale', () => {
    const snapshot = buildTimelineSnapshot(
      project({
        clips: [
          { id: 'clip-a', name: 'a', duration: 5, startTime: 99 },
          { id: 'clip-b', name: 'b', duration: 5, startTime: 100 },
        ],
      }),
    );

    expect(snapshot.clips.map((clip) => clip.startTime)).toEqual([0, 5]);
  });

  it('normalizes optional clip fields to their output defaults', () => {
    const snapshot = buildTimelineSnapshot(
      project({ clips: [{ id: 'clip-x', name: 'x', duration: 3 }] }),
    );

    expect(snapshot.clips[0]).toEqual({
      order: 0,
      id: 'clip-x',
      name: 'x',
      track: 0,
      startTime: 0,
      duration: 3,
      sourceDuration: 3,
      trimStart: 0,
      textOverlay: null,
      transitionIn: null,
    });
  });

  it('passes through track, textOverlay, and transitionIn when present', () => {
    const snapshot = buildTimelineSnapshot(project());

    expect(snapshot.clips[1]).toMatchObject({ track: 1, transitionIn: 'fade' });
    expect(snapshot.clips[2]).toMatchObject({ textOverlay: 'Thanks for watching' });
  });

  it('defaults the playhead to 0 when the project does not persist one', () => {
    expect(buildTimelineSnapshot(project()).playhead).toBe(0);
    expect(buildTimelineSnapshot(project({ playhead: 7.5 })).playhead).toBe(7.5);
  });

  it('carries project identity into the snapshot', () => {
    const snapshot = buildTimelineSnapshot(project());
    expect(snapshot.projectId).toBe('proj-1');
    expect(snapshot.name).toBe('Launch teaser');
  });

  it('serializes an empty timeline to a zeroed snapshot', () => {
    const snapshot = buildTimelineSnapshot(project({ clips: [] }));

    expect(snapshot).toEqual({
      projectId: 'proj-1',
      name: 'Launch teaser',
      playhead: 0,
      duration: 0,
      clipCount: 0,
      clips: [],
    });
  });
});
