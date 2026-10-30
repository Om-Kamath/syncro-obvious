import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_HTTP_PORT, parsePortFlag, resolveMcpHttpPort } from './args';

describe('parsePortFlag', () => {
  it('reads --port=<n>', () => {
    expect(parsePortFlag(['--port=4000'])).toBe(4000);
  });

  it('reads --port <n>', () => {
    expect(parsePortFlag(['--port', '4000'])).toBe(4000);
  });

  it('returns undefined when the flag is absent', () => {
    expect(parsePortFlag([])).toBeUndefined();
    expect(parsePortFlag(['--verbose'])).toBeUndefined();
  });

  it('throws when --port has no value', () => {
    expect(() => parsePortFlag(['--port'])).toThrow('--port requires a value');
  });

  it('throws on non-integer and out-of-range values', () => {
    expect(() => parsePortFlag(['--port=abc'])).toThrow('Invalid MCP port "abc"');
    expect(() => parsePortFlag(['--port=0'])).toThrow('Invalid MCP port "0"');
    expect(() => parsePortFlag(['--port=70000'])).toThrow('Invalid MCP port "70000"');
    expect(() => parsePortFlag(['--port=3010.5'])).toThrow('Invalid MCP port "3010.5"');
  });
});

describe('resolveMcpHttpPort', () => {
  it('prefers the flag over env and default', () => {
    expect(resolveMcpHttpPort(['--port=4000'], '5000')).toBe(4000);
  });

  it('falls back to the env value', () => {
    expect(resolveMcpHttpPort([], '5000')).toBe(5000);
    expect(resolveMcpHttpPort(['--host=x'], '5000')).toBe(5000);
  });

  it('falls back to the default with no flag and no env', () => {
    expect(resolveMcpHttpPort([])).toBe(DEFAULT_MCP_HTTP_PORT);
    expect(resolveMcpHttpPort([], '')).toBe(DEFAULT_MCP_HTTP_PORT);
    expect(resolveMcpHttpPort([], '   ')).toBe(DEFAULT_MCP_HTTP_PORT);
  });

  it('throws on invalid env values', () => {
    expect(() => resolveMcpHttpPort([], 'not-a-port')).toThrow('Invalid MCP port "not-a-port"');
  });
});
