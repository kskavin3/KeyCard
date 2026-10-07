import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const cookieName = 'keycard_provider_session';
const sessionLifetimeSeconds = 8 * 60 * 60;

function sessionSecret() {
  const secret = process.env.KEYCARD_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('KEYCARD_SESSION_SECRET must contain at least 32 bytes.');
  }
  return secret;
}

function signature(payload: string) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function timingSafeStringEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createProviderSession(res: Response, providerId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
  const payload = Buffer.from(JSON.stringify({
    providerId,
    expiresAt,
    nonce: randomBytes(16).toString('hex'),
  })).toString('base64url');
  const token = `${payload}.${signature(payload)}`;
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: sessionLifetimeSeconds * 1000,
    path: '/',
  });
  return expiresAt;
}

export function clearProviderSession(res: Response) {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', path: '/' });
}

export function requireProviderSession(req: Request, res: Response, next: NextFunction) {
  const rawCookie = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!rawCookie) return res.status(401).json({ error: 'Sign in to manage provider listings.' });

  const [payload, receivedSignature, extra] = rawCookie.split('.');
  if (!payload || !receivedSignature || extra) return res.status(401).json({ error: 'Invalid session.' });
  if (!timingSafeStringEqual(signature(payload), receivedSignature)) {
    return res.status(401).json({ error: 'Invalid session.' });
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.providerId !== 'string' || !data.providerId || data.expiresAt <= Date.now() / 1000) {
      return res.status(401).json({ error: 'Session expired.' });
    }
    res.locals.providerId = data.providerId as string;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid session.' });
  }
}

export function verifyProviderPassword(received: unknown) {
  const configured = process.env.KEYCARD_DASHBOARD_PASSWORD;
  if (typeof received !== 'string' || !configured) return false;
  return timingSafeStringEqual(
    createHmac('sha256', sessionSecret()).update(received).digest('hex'),
    createHmac('sha256', sessionSecret()).update(configured).digest('hex'),
  );
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request rejected.' });
    } catch {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
  }
  return next();
}
