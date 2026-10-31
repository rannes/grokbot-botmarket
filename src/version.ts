import { createRequire } from 'node:module';

/** The package version; the relative path resolves from both src/ and dist/. */
export const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
