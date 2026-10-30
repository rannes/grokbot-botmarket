import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';

// implemented in Task 11
export function adminRoutes(_deps: AppDeps): Hono {
  return new Hono();
}
