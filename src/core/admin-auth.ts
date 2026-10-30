import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { resolveDeps, type AppDeps } from '../deps.js';

export const ADMIN_COOKIE = 'bm_admin';

export function signAdminCookie(token: string, salt: string): string {
  return createHmac('sha256', token).update(`botmarket-admin:${salt}`).digest('hex');
}

/** Constant-time string comparison: hash both sides so lengths always match. */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export function verifyAdminToken(candidate: string, token: string): boolean {
  return safeEqual(candidate, token);
}

export function verifyAdminCookie(value: string | undefined, token: string, salt: string): boolean {
  if (!value) return false;
  return safeEqual(value, signAdminCookie(token, salt));
}

export function hasBearerAdmin(c: Context, deps: AppDeps): boolean {
  const token = deps.config.adminToken;
  if (!token) return false;
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
  return m ? verifyAdminToken(m[1]!.trim(), token) : false;
}

export function isAdminRequest(c: Context, deps: AppDeps): boolean {
  const token = deps.config.adminToken;
  if (!token) return false;
  if (hasBearerAdmin(c, deps)) return true;
  return verifyAdminCookie(getCookie(c, ADMIN_COOKIE), token, resolveDeps(deps).salt);
}
