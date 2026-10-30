import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { resolveDeps, type AppDeps } from '../deps.js';

export const ADMIN_COOKIE = 'bm_admin';

export function signAdminCookie(token: string, salt: string): string {
  return createHmac('sha256', token).update(`botmarket-admin:${salt}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyAdminCookie(value: string | undefined, token: string, salt: string): boolean {
  if (!value) return false;
  return safeEqual(value, signAdminCookie(token, salt));
}

export function hasBearerAdmin(c: Context, deps: AppDeps): boolean {
  const token = deps.config.adminToken;
  if (!token) return false;
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
  return m ? safeEqual(m[1]!.trim(), token) : false;
}

export function isAdminRequest(c: Context, deps: AppDeps): boolean {
  const token = deps.config.adminToken;
  if (!token) return false;
  if (hasBearerAdmin(c, deps)) return true;
  return verifyAdminCookie(getCookie(c, ADMIN_COOKIE), token, resolveDeps(deps).salt);
}
