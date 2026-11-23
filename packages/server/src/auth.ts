import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const COOKIE = 'rf_session';

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The cookie value is derived from the admin token, so it needs no session store and dies when the token changes. */
export const sessionValue = (token: string): string => createHmac('sha256', token).update('radioformer-session-v1').digest('hex');

function cookieOf(req: FastifyRequest, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

export function isAdmin(req: FastifyRequest, token: string | undefined): boolean {
  if (!token) return false;
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (bearer && same(bearer, token)) return true;
  const cookie = cookieOf(req, COOKIE);
  return cookie !== '' && same(cookie, sessionValue(token));
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header('Set-Cookie', `${COOKIE}=${sessionValue(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
}
export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export { same as constantTimeEqual };
