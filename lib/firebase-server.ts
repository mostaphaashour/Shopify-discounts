import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { localUser } from './local-auth.ts';
import { canUseApp } from './access.ts';

export class AccessError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function requireUser(request: Request) {
  const temporary = localUser(request);
  if (temporary) return temporary;
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new AccessError('سجّل الدخول أولًا', 401);
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId || projectId.startsWith('YOUR_')) throw new AccessError('إعدادات Firebase على السيرفر غير مكتملة', 503);
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new AccessError('نسخة التطبيق هذه تتطلب Firebase الحقيقي، وليس محاكي المصادقة', 503);
  const token = authorization.slice(7);
  const app = getApps().find(value => value.name === 'sku-auth') ?? initializeApp({ projectId }, 'sku-auth');
  let uid: string;
  try { uid = (await getAuth(app).verifyIdToken(token)).uid; }
  catch { throw new AccessError('جلسة الدخول غير صالحة؛ سجّل الدخول من جديد', 401); }
  // Read through Firestore REST using the user's verified token. No service-account
  // key is required, and Firestore rules still apply to this request.
  type FirestoreValue = { booleanValue?: boolean; integerValue?: string; doubleValue?: number; stringValue?: string; timestampValue?: string };
  async function readAccess(collection: string): Promise<Record<string, FirestoreValue>> {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId!)}/databases/(default)/documents/${collection}/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return {};
    if (!response.ok) throw new AccessError('تعذر التحقق من صلاحية الحساب في Firebase', 403);
    return ((await response.json()) as { fields?: Record<string, FirestoreValue> }).fields ?? {};
  }
  const admin = await readAccess('admins');
  if (admin.enabled?.booleanValue === true) return { uid };
  const member = await readAccess('members');
  if (!canUseApp(false, {
    enabled: member.enabled?.booleanValue, paymentVerified: member.paymentVerified?.booleanValue,
    amount: Number(member.amount?.integerValue ?? member.amount?.doubleValue), currency: member.currency?.stringValue,
    plan: member.plan?.stringValue, expiresAt: member.expiresAt?.timestampValue,
  })) throw new AccessError('الاشتراك غير مفعّل أو انتهى؛ اطلب التجديد وموافقة الأدمن', 403);
  return { uid };
}
