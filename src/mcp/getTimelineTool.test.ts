import { describe, expect, it } from 'vitest';
import {
  GET_TIMELINE_TOOL_DESCRIPTION,
  GET_TIMELINE_TOOL_NAME,
  getTimelineInputSchema,
  handleGetTimeline,
  parseGetTimelineArgs,
} from './getTimelineTool';
import { InMemoryProjectStore } from './projectStore';

function storeWithSampleProject(): InMemoryProjectStore {
  return new InMemoryProjectStore().put({
    id: 'proj-1',
    name: 'Launch teaser',
    clips: [
      { id: 'clip-a', name: 'intro.mp4', duration: 10, trimmedDuration: 4 },
      { id: 'clip-b', name: 'demo.mp4', duration: 8 },
    ],
  });
}

describe('get_timeline metadata', () => {
  it('declares the get_timeline tool with a required projectId string', () => {
    expect(GET_TIMELINE_TOOL_NAME).toBe('get_timeline');
    expect(GET_TIMELINE_TOOL_DESCRIPTION.length).toBeGreaterThan(0);
    expect(getTimelineInputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['projectId'],
    });
  });
});

describe('parseGetTimelineArgs', () => {
  it('accepts a non-empty projectId and trims it', () => {
    expect(parseGetTimelineArgs({ projectId: '  proj-1 ' })).toEqual({
      ok: true,
      args: { projectId: 'proj-1' },
    });
  });

  it('rejects non-object input and blank or non-string projectIds', () => {
    expect(parseGetTimelineArgs(undefined).ok).toBe(false);
    expect(parseGetTimelineArgs('proj-1').ok).toBe(false);
    expect(parseGetTimelineArgs({ projectId: '   ' }).ok).toBe(false);
    expect(parseGetTimelineArgs({ projectId: 7 }).ok).toBe(false);
  });
});

describe('handleGetTimeline', () => {
  it('resolves the project and returns the serialized timeline snapshot', async () => {
    const result = await handleGetTimeline(storeWithSampleProject(), { projectId: 'proj-1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timeline).toEqual({
        projectId: 'proj-1',
        name: 'Launch teaser',
        playhead: 0,
        duration: 12,
        clipCount: 2,
        clips: [
          expect.objectContaining({ order: 0, id: 'clip-a', startTime: 0, duration: 4 }),
          expect.objectContaining({ order: 1, id: 'clip-b', startTime: 4, duration: 8 }),
        ],
      });
    }
  });

  it('returns an error result for an unknown project', async () => {
    const result = await handleGetTimeline(new InMemoryProjectStore(), { projectId: 'missing' });

    expect(result).toEqual({ ok: false, error: 'Project not found: missing' });
  });

  it('returns an error result for invalid arguments', async () => {
    const result = await handleGetTimeline(storeWithSampleProject(), { projectId: '' });

    expect(result.ok).toBe(false);
  });
});
