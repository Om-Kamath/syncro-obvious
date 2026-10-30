import { describe, expect, it } from 'vitest';
import { EXPORT_PRESETS } from '../utils/exportPresets';
import { createExportJobStore } from './exportJobQueue';
import {
  TRIGGER_EXPORT_TOOL_DESCRIPTION,
  TRIGGER_EXPORT_TOOL_NAME,
  handleTriggerExport,
  triggerExportInputSchema,
} from './triggerExport';

describe('trigger_export tool metadata', () => {
  it('exposes the MCP tool name, a non-empty description, and a closed input schema', () => {
    expect(TRIGGER_EXPORT_TOOL_NAME).toBe('trigger_export');
    expect(TRIGGER_EXPORT_TOOL_DESCRIPTION.length).toBeGreaterThan(0);
    expect(triggerExportInputSchema.required).toEqual(['projectId', 'preset']);
    expect(triggerExportInputSchema.additionalProperties).toBe(false);
  });

  it('keeps the preset enum in sync with EXPORT_PRESETS', () => {
    expect(triggerExportInputSchema.properties.preset.enum).toEqual(Object.keys(EXPORT_PRESETS));
  });

  it('advertises every quality tier', () => {
    expect(triggerExportInputSchema.properties.quality.enum).toEqual([
      'low',
      'medium',
      'high',
      'source',
    ]);
  });
});

describe('handleTriggerExport', () => {
  it('enqueues a job and reports its id with queued status', () => {
    const store = createExportJobStore({
      generateId: () => 'job-1',
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const result = handleTriggerExport(store, {
      projectId: 'proj-1',
      preset: 'vertical',
      quality: 'high',
    });
    expect(result).toEqual({ ok: true, jobId: 'job-1', status: 'queued' });
    expect(store.get('job-1')).toMatchObject({
      projectId: 'proj-1',
      preset: 'vertical',
      quality: 'high',
      status: 'queued',
    });
  });

  it('defaults quality to source when omitted', () => {
    const store = createExportJobStore();
    const result = handleTriggerExport(store, { projectId: 'proj-1', preset: 'wide' });
    expect(result).toMatchObject({ ok: true, status: 'queued' });
    if (!result.ok) return;
    expect(store.get(result.jobId)).toMatchObject({ quality: 'source' });
  });

  it('accepts every advertised aspect preset', () => {
    const store = createExportJobStore();
    Object.keys(EXPORT_PRESETS).forEach((preset, index) => {
      const result = handleTriggerExport(store, { projectId: 'proj-1', preset });
      expect(result).toMatchObject({ ok: true, status: 'queued' });
      const jobs = store.listByProject('proj-1');
      expect(jobs).toHaveLength(index + 1);
      expect(jobs[index].preset).toBe(preset);
    });
  });

  it('rejects an unknown preset and names the valid ones', () => {
    const result = handleTriggerExport(createExportJobStore(), {
      projectId: 'proj-1',
      preset: 'cinemascope',
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('wide, vertical, square') });
  });

  it('rejects missing or blank projectId', () => {
    const store = createExportJobStore();
    const missing = handleTriggerExport(store, { preset: 'wide' });
    expect(missing).toEqual({ ok: false, error: expect.stringContaining('projectId') });
    const blank = handleTriggerExport(store, { projectId: '  ', preset: 'wide' });
    expect(blank).toEqual({ ok: false, error: expect.stringContaining('projectId') });
  });

  it('rejects a quality outside the advertised enum', () => {
    const result = handleTriggerExport(createExportJobStore(), {
      projectId: 'proj-1',
      preset: 'wide',
      quality: 'ultra',
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('quality must be one of') });
  });

  it('rejects non-object arguments', () => {
    const store = createExportJobStore();
    expect(handleTriggerExport(store, null).ok).toBe(false);
    expect(handleTriggerExport(store, 'export now').ok).toBe(false);
  });

  it('leaves the queue untouched when validation fails', () => {
    const store = createExportJobStore();
    handleTriggerExport(store, { projectId: 'proj-1', preset: 'nope' });
    expect(store.listByProject('proj-1')).toHaveLength(0);
  });
});
