import { randomBytes } from 'node:crypto';
import type { Config } from './config.js';
import { RateLimiter } from './core/rate-limit.js';
import { fetchTemplateMetadata } from './core/xai-metadata.js';
import type { BotsRepo } from './db/bots-repo.js';

export interface AppDeps {
  repo: BotsRepo;
  config: Config;
  fetchMetadata?: typeof fetchTemplateMetadata;
  now?: () => Date;
  /** Salt for visitorHash; defaults to a random string per process. */
  salt?: string;
  /** Shared limiter for bot submissions (web form and JSON API); defaults to 10/hour per IP. */
  submitLimiter?: RateLimiter;
}

export type ResolvedDeps = AppDeps & Required<Pick<AppDeps, 'fetchMetadata' | 'now' | 'salt' | 'submitLimiter'>>;

const PROCESS_SALT = randomBytes(16).toString('hex');
export const SUBMIT_LIMIT = 10;
export const SUBMIT_WINDOW_MS = 60 * 60 * 1000;

/** Fill in defaults. Idempotent: resolving resolved deps returns the same values (and the same limiter). */
export function resolveDeps(deps: AppDeps): ResolvedDeps {
  return {
    ...deps,
    fetchMetadata: deps.fetchMetadata ?? fetchTemplateMetadata,
    now: deps.now ?? (() => new Date()),
    salt: deps.salt ?? PROCESS_SALT,
    submitLimiter: deps.submitLimiter ?? new RateLimiter(SUBMIT_LIMIT, SUBMIT_WINDOW_MS),
  };
}
