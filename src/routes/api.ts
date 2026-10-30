import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';

// implemented in Task 10
export function apiRoutes(_deps: AppDeps): Hono {
  return new Hono();
}
