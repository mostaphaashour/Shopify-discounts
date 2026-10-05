'use client';
import { useEffect, useState } from 'react';
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { firebaseClient } from '../lib/firebase-client';
import { expiryMillis, type Membership } from '../lib/access';

export default function SubscriptionPanel({ user, member }: { user: User; member: Membership | null }) {
  const [payment, setPayment] = useState({ phone: '01126813849', localAmount: '', instructions: '' });
  const [requestState, setRequestState] = useState<{ status?: string; paymentState?: string } | null>(null);
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const { db } = firebaseClient();
    const stopSettings = onSnapshot(doc(db, 'settings', 'payment'), snapshot => {
      if (snapshot.exists()) setPayment(snapshot.data() as typeof payment);
    }, () => setMessage('تعذر تحميل تعليمات الدفع؛ راجع اتصال Firebase'));
    const stopRequest = onSnapshot(doc(db, 'accessRequests', user.uid), snapshot => setRequestState(snapshot.exists() ? snapshot.data() : null), () => setMessage('تعذر تحميل حالة الطلب'));
    return () => { stopSettings(); stopRequest(); };
  }, [user.uid]);
  async function submit(paymentState: 'will_pay' | 'claimed_paid') {
    if (paymentState === 'claimed_paid' && !reference.trim()) { setMessage('أدخل رقم العملية أو مرجع التحويل'); return; }
    setWorking(true); setMessage('');
    try {
      const { db } = firebaseClient();
      const target = doc(db, 'accessRequests', user.uid);
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(target);
        const data = { paymentState, reference: reference.trim(), status: 'pending', updatedAt: serverTimestamp() };
        if (existing.exists()) transaction.update(target, data);
        else transaction.set(target, { ...data, uid: user.uid, email: user.email ?? '', amount: 10, currency: 'USD', plan: 'monthly', createdAt: serverTimestamp() });
      });
      setMessage('تم إرسال الطلب للأدمن. التفعيل يتم بعد مراجعته وموافقته.');
    } catch { setMessage('لم يتم إرسال الطلب؛ راجع اتصال Firebase وقواعد الأمان'); }
    finally { setWorking(false); }
  }
  const expires = expiryMillis(member);
  return <section className="panel subscription" dir="rtl">
    <h2>الاشتراك الشهري · 10 دولار</h2>
    {expires > 0 && <p>نهاية الفترة المسجلة: {new Date(expires).toLocaleString('ar-EG')}{member?.enabled === false && ' · الحساب موقوف'}</p>}
    <p>الدفع عبر إنستا باي إلى <strong dir="ltr">{payment.phone}</strong>.</p>
    <p>{payment.localAmount ? `قيمة التحويل المحددة: ${payment.localAmount} جنيه مصري.` : 'تواصل مع الأدمن لتحديد قيمة التحويل بالجنيه قبل الدفع.'}</p>
    {payment.instructions && <p style={{ whiteSpace: 'pre-wrap' }}>{payment.instructions}</p>}
    <p className="hint">لا يوجد خصم تلقائي أو تجديد آلي. بعد مراجعة التحويل، موافقة الأدمن تضيف شهرًا؛ إذا كان اشتراكك ساريًا يُضاف الشهر إلى نهايته.</p>
    <p role="status">{requestState?.status === 'pending' ? requestState.paymentState === 'claimed_paid' ? 'بلاغ الدفع بانتظار مراجعة الأدمن' : 'طلب الاشتراك وصل للأدمن؛ لم تبلغ بالدفع بعد' : requestState?.status === 'rejected' ? 'الطلب مرفوض؛ راجع بيانات الدفع وأرسل طلبًا جديدًا' : requestState?.status === 'approved' ? 'تمت الموافقة على آخر طلب. يمكنك طلب التجديد عند الحاجة.' : 'لم ترسل طلبًا بعد'}</p>
    <label>رقم العملية / مرجع التحويل<input maxLength={300} value={reference} onChange={event => setReference(event.target.value)} placeholder="مرجع يساعد الأدمن على مطابقة التحويل"/></label>
    <div className="payment-actions"><button className="secondary" disabled={working} onClick={() => submit('will_pay')}>أرغب بالاشتراك / التجديد</button><button disabled={working || !reference.trim()} onClick={() => submit('claimed_paid')}>دفعت — إرسال للمراجعة</button></div>
    <p role="alert">{message}</p>
  </section>;
}
