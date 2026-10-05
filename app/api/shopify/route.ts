import { checkOrigin } from '../../../lib/request-origin';
import { COOKIE, MAX_SESSION_AGE, encodeSession, decodeSession, sessionCookie } from '../../../lib/session-cookie';
import { z } from 'zod';
import { requireUser, AccessError } from '../../../lib/firebase-server';
import { createShopifyClient, normalizeShop, requestToken, ShopifyOperationError } from '../../../lib/shopify';

export const runtime = 'nodejs';
const payloadSchema = z.object({
  action: z.enum(['connect', 'disconnect', 'preview', 'apply']),
  operation: z.enum(['discount', 'restore', 'manual', 'increase', 'tag']).default('discount'),
  tag: z.string().max(255).optional(),
  salePrice: z.string().max(40).optional(),
  beforePrice: z.string().max(40).optional(),
  increase: z.coerce.number().optional(),
  shop: z.string().max(255),
  clientId: z.string().max(255).optional(),
  secret: z.string().max(2048).optional(),
  discount: z.coerce.number().optional(),
  basis: z.enum(['original', 'current']).optional(),
  sku: z.string().trim().min(1).max(255).optional(),
  row: z.object({
    id: z.string(), sku: z.string(), productId: z.string(), title: z.string(),
    price: z.string(), compareAtPrice: z.string().nullable(), newPrice: z.string(), base: z.string(),
    operation: z.enum(['discount', 'restore', 'manual', 'increase', 'tag']).optional(), skipped: z.string().optional(),
    tag: z.string().max(255).optional(),
    newCompareAtPrice: z.string().nullable().optional(),
  }).optional(),
});

export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  try {
    const user = await requireUser(request);
    const { local, secure } = checkOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('نوع طلب غير صالح');
    const text = await request.text();
    if (text.length > 16_384) throw new Error('الطلب أكبر من الحد المسموح');
    const parsed = payloadSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error('بيانات الطلب غير صالحة؛ راجع الحقول ونسبة الخصم.');
    const body = parsed.data;
    const sessionId = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (body.action === 'disconnect') {
      headers.set('Set-Cookie', sessionCookie('', secure, 0));
      return Response.json({ disconnected: true }, { headers });
    }
    const shop = normalizeShop(body.shop);
    if (body.action === 'connect') {
      if (!body.clientId || !body.secret) throw new Error('أدخل Client ID وClient Secret');
      const credentials = { shop, clientId: body.clientId.trim(), secret: body.secret.trim() };
      const token = await requestToken(credentials);
      const info = await createShopifyClient(shop, token.token).info();
      const value = encodeSession({ ...credentials, ...token, uid: user.uid, createdAt: Date.now(), currency: info.currencyCode, name: info.name }, local);
      headers.set('Set-Cookie', sessionCookie(value, secure));
      return Response.json({ name: info.name, currency: info.currencyCode }, { headers });
    }
    const session = decodeSession(sessionId, user.uid, local);
    if (!session || session.uid !== user.uid || session.shop !== shop) throw new Error('انتهت الجلسة أو اتغير المتجر؛ أعد الربط.');
    if (session.expiresAt - Date.now() < 60_000) {
      Object.assign(session, await requestToken(session));
      headers.set('Set-Cookie', sessionCookie(encodeSession(session, local), secure, (session.createdAt + MAX_SESSION_AGE - Date.now()) / 1000));
    }
    const client = createShopifyClient(shop, session.token);
    if (body.operation === 'tag') {
      if (!body.tag?.trim()) throw new Error('أدخل التاج المطلوب');
      if (body.action === 'preview' && body.sku) {
        return Response.json({ row: await client.previewTag(body.sku, body.tag) }, { headers });
      }
      if (body.action === 'apply' && body.row) {
        return Response.json({ status: await client.applyTag(body.row, body.tag) }, { headers });
      }
      throw new Error('الطلب غير مكتمل؛ أعد المعاينة');
    }
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: session.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    if (body.operation === 'manual' || body.operation === 'increase') {
      if (body.operation === 'manual' && !body.salePrice?.trim()) throw new Error('أدخل سعر البيع النهائي');
      const settings = { operation: body.operation, salePrice: body.salePrice, beforePrice: body.beforePrice, increase: body.increase };
      if (body.action === 'preview' && body.sku) {
        return Response.json({ row: await client.previewTarget(body.sku, settings, digits) }, { headers });
      }
      if (body.action === 'apply' && body.row) {
        return Response.json({ status: await client.applyTarget(body.row, settings, digits) }, { headers });
      }
      throw new Error('الطلب غير مكتمل؛ أعد المعاينة');
    }
    if (body.operation === 'restore') {
      if (body.action === 'preview' && body.sku) {
        return Response.json({ row: await client.previewRestore(body.sku) }, { headers });
      }
      if (body.action === 'apply' && body.row) {
        return Response.json({ status: await client.applyRestore(body.row) }, { headers });
      }
      throw new Error('الطلب غير مكتمل؛ أعد المعاينة');
    }
    if (body.row?.operation && body.row.operation !== 'discount') throw new Error('نوع العملية اتغير؛ أعد المعاينة');
    if (body.discount === undefined || body.basis === undefined) throw new Error('أدخل نسبة الخصم وأساس الحساب');
    if (body.action === 'preview' && body.sku) {
      return Response.json({ row: await client.preview(body.sku, body.discount, body.basis, digits) }, { headers });
    }
    if (body.action === 'apply' && body.row) {
      return Response.json({ status: await client.apply(body.row, body.discount, body.basis, digits) }, { headers });
    }
    throw new Error('الطلب غير مكتمل؛ أعد المعاينة');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر إكمال الطلب';
    return Response.json({ error: message, code: error instanceof ShopifyOperationError ? error.code : 'OPERATION_FAILED' }, { status: error instanceof AccessError ? error.status : 400, headers });
  }
}




