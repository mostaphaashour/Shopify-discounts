import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Credentials } from './shopify.ts';

export const COOKIE = 'shopify_session_v2';
export const MAX_SESSION_AGE = 24 * 60 * 60 * 1000;
export type Session = Credentials & { uid: string; token: string; expiresAt: number; createdAt: number; currency: string; name: string };
const state = globalThis as typeof globalThis & { localShopifyEncryptionKey?: Buffer };

function key(local: boolean) {
  const configured = process.env.SESSION_ENCRYPTION_KEY;
  if (configured && /^[a-fA-F0-9]{64}$/.test(configured)) return Buffer.from(configured, 'hex');
  if (configured || !local || process.env.NETLIFY === 'true') throw new Error('أضف SESSION_ENCRYPTION_KEY صالحًا في إعدادات الاستضافة: 64 رمز hex');
  return state.localShopifyEncryptionKey ??= randomBytes(32);
}
export function encodeSession(session: Session, local: boolean) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(local), iv);
  cipher.setAAD(Buffer.from(COOKIE));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  if (value.length > 3800) throw new Error('بيانات جلسة المتجر أكبر من حد الكوكي؛ لا يمكن حفظ الربط بهذه البيانات');
  return value;
}
export function decodeSession(value: string | undefined, uid: string, local: boolean, now = Date.now()): Session | null {
  const secret = key(local);
  if (!value || value.length > 3800 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(COOKIE));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as Session;
    if (session.uid !== uid || !Number.isFinite(session.createdAt) || session.createdAt > now
      || now - session.createdAt >= MAX_SESSION_AGE || !Number.isFinite(session.expiresAt)
      || !['shop','clientId','secret','token','currency','name'].every(field => typeof session[field as keyof Session] === 'string')) return null;
    return session;
  } catch { return null; }
}
export function sessionCookie(value: string, secure: boolean, maxAge = MAX_SESSION_AGE / 1000) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/shopify; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`;
}
