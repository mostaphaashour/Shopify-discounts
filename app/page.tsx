"use client";
import { useEffect, useState } from 'react';
import { onAuthStateChanged, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { firebaseClient, firebaseConfigured } from '../lib/firebase-client';
import { listRuns, readRunRows, saveRun, type RunInput, type RunSummary } from '../lib/history';
import { type Outcome } from '../lib/results';
import PricingApp from '../components/PricingApp';
import ResultFields from '../components/ResultFields';
import SubscriptionPanel from '../components/SubscriptionPanel';
import AdminPanel from '../components/AdminPanel';
import { canUseApp, type Membership } from '../lib/access';

const labels: Record<string, string> = { manual: 'تحديد أسعار', discount: 'خصم بنسبة', increase: 'زيادة بنسبة', restore: 'استرجاع السعر', tag: 'إضافة تاج' };

function FirebaseHome() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [member, setMember] = useState<Membership | null>(null);
  const [accessFailed, setAccessFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const allowed = !accessFailed && canUseApp(isAdmin, member, now);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const [historicalRows, setHistoricalRows] = useState<{ sku: string; outcome: Outcome; detail: string }[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    if (!firebaseConfigured) { setLoading(false); return () => clearInterval(timer); }
    let cleanAccess = () => {};
    const unsubscribe = onAuthStateChanged(firebaseClient().auth, current => {
      cleanAccess(); setUser(current); setIsAdmin(false); setMember(null); setAccessFailed(false);
      setRuns([]); setHistoricalRows([]); setNow(Date.now());
      if (!current) { setLoading(false); return; }
      setLoading(true);
      let adminReady = false, memberReady = false;
      const finish = () => { if (adminReady && memberReady) setLoading(false); };
      const fail = () => { setAccessFailed(true); setLoading(false); setMessage('تعذر التحقق من الصلاحيات؛ راجع اتصال Firebase وقواعد الأمان.'); };
      const stopAdmin = onSnapshot(doc(firebaseClient().db, 'admins', current.uid), snapshot => {
        setIsAdmin(snapshot.exists() && snapshot.data()?.enabled === true); adminReady = true; finish();
      }, fail);
      const stopMember = onSnapshot(doc(firebaseClient().db, 'members', current.uid), snapshot => {
        setMember(snapshot.exists() ? snapshot.data() as Membership : null); memberReady = true; finish();
      }, fail);
      cleanAccess = () => { stopAdmin(); stopMember(); };
    });
    return () => { clearInterval(timer); unsubscribe(); cleanAccess(); };
  }, []);

  useEffect(() => {
    let active = true;
    if (user && allowed) listRuns(user.uid).then(items => { if (active) { setRuns(items); setHistoryMessage(''); } }).catch(() => { if (active) setHistoryMessage('تعذر تحميل السجل من Firebase'); });
    return () => { active = false; };
  }, [user, allowed]);

  async function login(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setMessage('');
    try {
      const { auth } = firebaseClient();
      await setPersistence(auth, browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
    } catch { setMessage('تعذر تسجيل الدخول. راجع الإيميل والباسورد وتفعيل Email/Password وإعدادات Firebase.'); }
    finally { setWorking(false); }
  }

  async function googleLogin() {
    setWorking(true); setMessage('');
    try { const { auth } = firebaseClient(); await setPersistence(auth, browserSessionPersistence); await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch { setMessage('تعذر الدخول بجوجل؛ تأكد من تفعيل Google في Firebase والسماح بالدومين الحالي.'); }
    finally { setWorking(false); }
  }

  async function logout() {
    setWorking(true);
    try {
      if (user) {
        try { await fetch('/api/shopify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ action: 'disconnect', shop: '' }) }); } catch { /* Session owner checks still protect any retained server session. */ }
      }
      await signOut(firebaseClient().auth);
      setPassword(''); setMessage('');
    } catch { setMessage('تعذر تسجيل الخروج؛ أعد المحاولة.'); }
    finally { setWorking(false); }
  }

  async function persist(run: RunInput) {
    if (!user) throw new Error('سجّل الدخول أولًا');
    await saveRun(user.uid, run);
    try { setRuns(await listRuns(user.uid)); setHistoryMessage(''); }
    catch { setHistoryMessage('تم الحفظ، لكن تعذر تحديث قائمة السجل'); }
  }

  async function openRun(id: string) {
    if (!user) return;
    setHistoryMessage('جاري تحميل النتائج…'); setHistoricalRows([]);
    try { const items = await readRunRows(user.uid, id); if (firebaseClient().auth.currentUser?.uid === user.uid) { setHistoricalRows(items); setHistoryMessage(''); } }
    catch { setHistoryMessage('تعذر تحميل نتائج العملية'); }
  }

  if (!firebaseConfigured) return <main dir="rtl"><section className="panel login"><h1>إعداد Firebase</h1><p>انسخ ملف .env.example إلى .env.local، وأدخل إعدادات مشروعك، ثم أعد تشغيل التطبيق.</p><p>خطوات تفعيل تسجيل الدخول وقاعدة البيانات والمستخدمين موجودة في FIREBASE-SETUP.md.</p></section></main>;
  if (loading) return <main dir="rtl"><p role="status">جاري التحقق من تسجيل الدخول…</p></main>;
  if (!user) return <main dir="rtl"><section className="panel login"><h1>تسجيل الدخول</h1><p>اشتراك 10 دولار شهريًا، يتفعّل بعد مراجعة الدفع وموافقة الأدمن.</p><button type="button" disabled={working} onClick={googleLogin}>تسجيل الدخول بحساب Google</button><p className="hint">أو بحساب إيميل وباسورد موجود</p><form onSubmit={login}><label>الإيميل<input type="email" dir="ltr" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required/></label><label>الباسورد<input type="password" dir="ltr" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required/></label><button disabled={working}>{working ? 'جاري الدخول…' : 'دخول'}</button></form><p role="alert">{message}</p></section></main>;
  if (!allowed) return <main dir="rtl"><div className="userbar"><span>{user.email}</span><button disabled={working} onClick={logout}>تسجيل الخروج</button></div><p role="alert">{message}</p><SubscriptionPanel user={user} member={member}/></main>;

  return <>
    <div className="userbar" dir="rtl"><span>{user.email}{isAdmin && " · أدمن — استخدام مجاني"}</span><button className="secondary" disabled={busy || working} onClick={logout}>تسجيل الخروج</button><span role="alert">{message}</span></div>
    {isAdmin ? <AdminPanel user={user}/> : <details className="subscription-renew" dir="rtl"><summary>اشتراكي وتجديده</summary><SubscriptionPanel user={user} member={member}/></details>}
    <PricingApp key={user.uid} getToken={() => user.getIdToken()} onSave={persist} onBusy={setBusy}/>
    <section className="panel history" dir="rtl"><h2>سجل عملياتك في Firebase</h2><p className="hint">آخر 10 دفعات. «الحفظ غير مكتمل» يعني أن بعض نتائج السجل قد تكون ناقصة.</p><p role="status">{historyMessage}</p>
      {!runs.length && <p>لا توجد عمليات محفوظة بعد.</p>}
      {runs.map(run => <div className="history-row" key={run.id}><span>{labels[run.operation] || run.operation} · {run.shop} · {run.total} SKU · مكتمل {run.completed} · غير مكتمل {run.incomplete} · غير موجود {run.missing} {run.state !== 'saved' && '· الحفظ غير مكتمل'}</span><button className="secondary" onClick={() => openRun(run.id)}>عرض النتائج</button></div>)}
      {historicalRows.length > 0 && <><div className="table-wrap"><table><thead><tr><th>SKU</th><th>النتيجة</th></tr></thead><tbody>{historicalRows.map(row => <tr key={row.sku}><td dir="ltr">{row.sku}</td><td>{row.detail || (row.outcome === 'ready' ? 'لم يُطبّق بعد' : row.outcome)}</td></tr>)}</tbody></table></div><ResultFields rows={historicalRows}/></>}
    </section>
  </>;
}



export default function Home() {
  const [mode, setMode] = useState<'loading' | 'temporary' | 'firebase' | 'error'>('loading');
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/local-auth', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw Error('تعذر التحقق من الدخول');
      const data = await response.json();
      if (active) { setMode(data.enabled ? 'temporary' : 'firebase'); setAuthenticated(data.authenticated); }
    }).catch(() => { if (active) setMode('error'); });
    return () => { active = false; };
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setMessage('');
    try {
      const response = await fetch('/api/local-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username, password }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setAuthenticated(true); setPassword('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر الدخول'); }
    finally { setWorking(false); }
  }
  async function logout() {
    setWorking(true);
    try {
      await fetch('/api/shopify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disconnect', shop: '' }) }).catch(() => {});
      const response = await fetch('/api/local-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
      if (!response.ok) throw Error('تعذر تسجيل الخروج');
      setAuthenticated(false); setMessage('');
    } catch { setMessage('تعذر تسجيل الخروج؛ أعد المحاولة.'); }
    finally { setWorking(false); }
  }
  if (mode === 'firebase') return <FirebaseHome/>;
  if (mode === 'loading' || mode === 'error') return <main dir="rtl"><p role="status">{mode === 'loading' ? 'جاري التحقق من الدخول…' : 'تعذر الاتصال بالسيرفر المحلي؛ حدّث الصفحة.'}</p></main>;
  if (!authenticated) return <main dir="rtl"><section className="panel login"><h1>الدخول المؤقت</h1><p>حساب محلي يعمل بدون إعداد Firebase.</p><form onSubmit={login}><label>اسم المستخدم<input dir="ltr" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required/></label><label>الباسورد<input dir="ltr" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required/></label><button disabled={working}>دخول</button></form><p role="alert">{message}</p></section></main>;
  return <><div className="userbar" dir="rtl"><span>أدمن محلي مؤقت · سجل Firebase وإدارة العملاء غير متاحين</span><button className="secondary" disabled={busy || working} onClick={logout}>تسجيل الخروج</button><span role="alert">{message}</span></div><PricingApp temporary getToken={async () => ''} onSave={async () => {}} onBusy={setBusy}/></>;
}
