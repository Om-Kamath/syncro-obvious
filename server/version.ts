import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

let cachedVersion: string | undefined;

/**
 * Syncro's version, read from package.json (cached after the first call).
 * Throws — surfaced by the /version route as a 500 — when package.json is
 * missing or has no version field; never silently reports "unknown".
 */
export function packageVersion(): string {
  cachedVersion ??= readPackageVersion(pkgPath);
  return cachedVersion;
}

function readPackageVersion(filePath: string): string {
  const pkg = JSON.parse(readFileSync(filePath, 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`No version field in ${filePath}`);
  }
  return pkg.version;
}
