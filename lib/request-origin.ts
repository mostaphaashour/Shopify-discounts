export function checkOrigin(request: Request) {
  const raw = request.headers.get('origin');
  if (!raw) throw new Error('طلب غير مسموح');
  const origin = new URL(raw);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.origin !== raw || origin.host !== request.headers.get('host')
    || (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))
    || (local && process.env.NETLIFY === 'true')) throw new Error('طلب غير مسموح');
  return { local, secure: origin.protocol === 'https:' };
}
