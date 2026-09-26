import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const UNKNOWN_VERSION = 'unknown';

interface PackageManifest {
  readonly version?: unknown;
}

/**
 * Process-level facts the health report needs. The version is read from the API
 * package manifest at startup; the same relative depth works from `src` and from
 * the compiled `dist` output.
 */
@Injectable()
export class ApplicationMetadata {
  public readonly version: string;

  private readonly startedAtMs: number;

  public constructor() {
    this.version = readPackageVersion();
    this.startedAtMs = Date.now();
  }

  public uptimeSeconds(): number {
    return Math.max(0, (Date.now() - this.startedAtMs) / 1000);
  }
}

function readPackageVersion(): string {
  try {
    const manifestPath = resolve(__dirname, '../../package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
    return typeof manifest.version === 'string' ? manifest.version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}
