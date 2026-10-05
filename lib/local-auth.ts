import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const LOCAL_COOKIE = 'sku_temporary_login';
const state = globalThis as typeof globalThis & {
  localLogins?: Map<string, number>;
  localAttempts?: { count: number; until: number };
};
const sessions = state.localLogins ??= new Map<string, number>();

export function localAuthEnabled() {
  const configured = [process.env.NEXT_PUBLIC_FIREBASE_API_KEY, process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, process.env.NEXT_PUBLIC_FIREBASE_APP_ID]
    .every(value => value && !value.startsWith('YOUR_'));
  return !configured && process.env.LOCAL_TEMP_LOGIN !== 'false';
}

export function localHost(request: Request) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.get('host') || '');
}

function cookieId(request: Request) {
  return request.headers.get('cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${LOCAL_COOKIE}=`))?.slice(LOCAL_COOKIE.length + 1);
}

export function localUser(request: Request) {
  if (!localAuthEnabled() || !localHost(request)) return null;
  for (const [id, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(id);
  const id = cookieId(request);
  return id && sessions.has(id) ? { uid: `temporary:${id}` } : null;
}

export function loginLocal(request: Request, username: string, password: string) {
  if (!localAuthEnabled() || !localHost(request)) throw new Error('الدخول المؤقت غير متاح');
  if (!state.localAttempts || state.localAttempts.until <= Date.now()) state.localAttempts = { count: 0, until: Date.now() + 300_000 };
  if (state.localAttempts.count >= 5) throw new Error('محاولات كثيرة؛ انتظر 5 دقائق ثم جرّب مجددًا');
  state.localAttempts.count++;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const expectedUser = process.env.LOCAL_TEMP_USER || 'admin';
  const expectedPassword = process.env.LOCAL_TEMP_PASSWORD || 'SkuLocal!8n4R27';
  const validUser = timingSafeEqual(hash(username), hash(expectedUser));
  const validPassword = timingSafeEqual(hash(password), hash(expectedPassword));
  if (!validUser || !validPassword) throw new Error('اسم المستخدم أو الباسورد غير صحيح');
  state.localAttempts.count = 0;
  logoutLocal(request);
  const id = randomBytes(32).toString('hex');
  sessions.set(id, Date.now() + 8 * 60 * 60 * 1000);
  return id;
}

export function logoutLocal(request: Request) {
  const id = cookieId(request);
  if (id) sessions.delete(id);
}
