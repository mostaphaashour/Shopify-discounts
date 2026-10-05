'use client';
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { firebaseClient } from '../lib/firebase-client';
import { extendOneMonth, expiryMillis, type Membership } from '../lib/access';

type PaymentRequest = { uid: string; email: string; status: string; paymentState: string; reference: string };
type Member = Membership & { uid: string; email: string };

export default function AdminPanel({ user }: { user: User }) {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  
  // 1. تهيئة القيم الافتراضية بنصوص فارغة أو قيم أولية صريحة
  const [phone, setPhone] = useState('01126813849');
  const [localAmount, setLocalAmount] = useState('');
  const [instructions, setInstructions] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const { db } = firebaseClient();
    const fail = () => setMessage('تعذر تحميل لوحة الأدمن. تأكد من نشر قواعد Firestore الجديدة.');
    
    const stopRequests = onSnapshot(collection(db, 'accessRequests'), snapshot => setRequests(snapshot.docs.map(item => item.data() as PaymentRequest)), fail);
    const stopMembers = onSnapshot(collection(db, 'members'), snapshot => setMembers(snapshot.docs.map(item => ({ ...item.data(), uid: item.id } as Member))), fail);
    
    // 2. إصلاح جلب البيانات لضمان عدم تمرير undefined وتحويل الأرقام لنصوص
    const stopSettings = onSnapshot(doc(db, 'settings', 'payment'), snapshot => {
      if (snapshot.exists()) { 
        const data = snapshot.data(); 
        if (data.phone) setPhone(String(data.phone)); 
        if (data.localAmount !== undefined) setLocalAmount(String(data.localAmount)); 
        if (data.instructions !== undefined) setInstructions(String(data.instructions)); 
      }
    }, fail);

    return () => { stopRequests(); stopMembers(); stopSettings(); };
  }, []);

  async function review(item: PaymentRequest, approve: boolean) {
    setWorking(true); setMessage('');
    try {
      const { db } = firebaseClient();
      const requestRef = doc(db, 'accessRequests', item.uid);
      const memberRef = doc(db, 'members', item.uid);
      await runTransaction(db, async transaction => {
        const [requestSnapshot, memberSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(memberRef)]);
        const current = requestSnapshot.data();
        if (!current || current.status !== 'pending') throw new Error('الطلب اتراجع بالفعل؛ حدّث القائمة');
        if (approve && current.paymentState !== 'claimed_paid') throw new Error('المستخدم لم يبلغ بالدفع بعد');
        if (approve) {
          const expiresAt = extendOneMonth(expiryMillis(memberSnapshot.data()));
          transaction.set(memberRef, { 
            enabled: true, 
            paymentVerified: true, 
            amount: 10, 
            currency: 'USD', 
            plan: 'monthly',
            expiresAt: Timestamp.fromDate(expiresAt), 
            approvedBy: user.uid, 
            email: current.email, 
            updatedAt: serverTimestamp() 
          });
        }
        transaction.update(requestRef, { status: approve ? 'approved' : 'rejected', reviewedBy: user.uid, updatedAt: serverTimestamp() });
      });
      setMessage(approve ? 'تم تأكيد الدفع وإضافة شهر للااشتراك' : 'تم رفض الطلب');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تحديث الطلب'); }
    finally { setWorking(false); }
  }

  async function suspend(member: Member) {
    setWorking(true);
    try { 
      await updateDoc(doc(firebaseClient().db, 'members', member.uid), { enabled: member.enabled === false, updatedAt: serverTimestamp() }); 
      setMessage(member.enabled === false ? 'تمت إعادة تفعيل الفترة المدفوعة' : 'تم إيقاف الوصول'); 
    }
    catch { setMessage('تعذر تحديث صلاحية الحساب'); }
    finally { setWorking(false); }
  }

  async function saveSettings() {
    const phoneVal = (phone || '01126813849').trim();
    const amountVal = (localAmount || '').trim();
    const instructionsVal = (instructions || '').trim();

    if (!phoneVal) { 
      setMessage('أدخل رقم إنستا باي'); 
      return; 
    }

    if (amountVal && (!Number.isFinite(Number(amountVal)) || Number(amountVal) <= 0)) { 
      setMessage('أدخل قيمة تحويل صحيحة بالجنيه'); 
      return; 
    }

    setWorking(true);
    try { 
      await setDoc(doc(firebaseClient().db, 'settings', 'payment'), { 
        phone: phoneVal, 
        localAmount: amountVal ? Number(amountVal) : 0, 
        instructions: instructionsVal, 
        updatedAt: serverTimestamp() 
      }); 
      setMessage('تم تحديث تعليمات الدفع بنجاح وسيظهر رقمك للعملاء الان'); 
    }
    catch { 
      setMessage('تعذر حفظ تعليمات الدفع'); 
    }
    finally { 
      setWorking(false); 
    }
  }

  const pending = requests.filter(item => item.status === 'pending');

  return (
    <section className="panel admin-panel" dir="rtl">
      <h2>لوحة الأدمن <span className="badge">{pending.length} طلب جديد بانتظارك</span></h2>
      <p className="hint">إشعارات الطلبات تظهر هنا فور وصولها أثناء فتح اللوحة. لا يتم تحصيل أموال من التطبيق؛ اضغط «تأكيد الدفع» بعد مطابقة التحويل بنفسك.</p>
      
      {/* 3. ضمان استمرار تمرير نص فارغ كـ fallback يمنع مشاكل Controlled inputs */}
      <details>
        <summary>تعليمات الدفع للمستخدمين</summary>
        <label>
          رقم إنستا باي
          <input 
            dir="ltr" 
            value={phone || ''} 
            maxLength={30} 
            onChange={event => setPhone(event.target.value)}
          />
        </label>
        <label>
          المبلغ المطلوب بالجنيه
          <input 
            dir="ltr" 
            inputMode="decimal" 
            maxLength={50} 
            value={localAmount || ''} 
            onChange={event => setLocalAmount(event.target.value)}
          />
        </label>
        <label>
          تعليمات إضافية
          <textarea 
            rows={3} 
            maxLength={2000} 
            value={instructions || ''} 
            onChange={event => setInstructions(event.target.value)}
          />
        </label>
        <button disabled={working} onClick={saveSettings}>حفظ التعليمات</button>
      </details>

      {!pending.length && <p>لا توجد طلبات معلّقة.</p>}
      {pending.map(item => (
        <div className="review-card" key={item.uid}>
          <strong>{item.email}</strong>
          <p>{item.paymentState === 'claimed_paid' ? 'المستخدم أبلغ بالدفع — يحتاج مراجعتك' : 'يرغب بالدفع — لم يبلغ بتحويل بعد'}</p>
          <p>مرجع التحويل: {item.reference || '—'}</p>
          <div className="payment-actions">
            <button disabled={working || item.paymentState !== 'claimed_paid'} onClick={() => review(item, true)}>راجعت التحويل — تأكيد الدفع وإضافة شهر</button>
            <button className="secondary" disabled={working} onClick={() => review(item, false)}>رفض الطلب</button>
          </div>
        </div>
      ))}

      <h3>الاشتراكات</h3>
      {members.map(member => (
        <div className="history-row" key={member.uid}>
          <span>{member.email} · {member.enabled === false ? 'موقوف' : expiryMillis(member) > Date.now() ? 'ساري' : 'منتهي'} · ينتهي {expiryMillis(member) ? new Date(expiryMillis(member)).toLocaleString('ar-EG') : '—'}</span>
          <button className="secondary" disabled={working || (member.enabled === false && expiryMillis(member) <= Date.now())} onClick={() => suspend(member)}>{member.enabled === false ? 'إعادة تفعيل الفترة المدفوعة' : 'إيقاف الوصول'}</button>
        </div>
      ))}

      <p role="status">{message}</p>
    </section>
  );
}