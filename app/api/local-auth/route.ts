import { LOCAL_COOKIE, localAuthEnabled, localHost, localUser, loginLocal, logoutLocal } from '../../../lib/local-auth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return Response.json({ enabled: localAuthEnabled() && localHost(request), authenticated: !!localUser(request) }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  try {
    const origin = new URL(request.headers.get('origin') || 'http://invalid');
    if (!localHost(request) || origin.host !== request.headers.get('host') || !['http:', 'https:'].includes(origin.protocol)) throw new Error('طلب غير مسموح');
    if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('طلب غير صالح');
    const text = await request.text();
    if (text.length > 4096) throw new Error('طلب أكبر من المسموح');
    const body = JSON.parse(text);
    if (body.action === 'logout') {
      logoutLocal(request);
      headers.set('Set-Cookie', `${LOCAL_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return Response.json({ authenticated: false }, { headers });
    }
    if (body.action !== 'login' || typeof body.username !== 'string' || typeof body.password !== 'string') throw new Error('أدخل اسم المستخدم والباسورد');
    const id = loginLocal(request, body.username.trim(), body.password);
    headers.set('Set-Cookie', `${LOCAL_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.protocol === 'https:' ? '; Secure' : ''}`);
    return Response.json({ authenticated: true }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'تعذر الدخول' }, { status: 401, headers });
  }
}
