"use client";
import { useState, useRef, useEffect } from "react";
import { type Outcome } from '../lib/results';
import type { RunInput } from '../lib/history';
import ResultFields from './ResultFields';
type Row = {
    sku: string;
    id?: string;
    productId?: string;
    title?: string;
    price?: string;
    compareAtPrice?: string | null;
    newPrice?: string;
    base?: string;
    error?: string;
    status?: string;
    operation?: 'discount' | 'restore' | 'manual' | 'increase' | 'tag';
    newCompareAtPrice?: string | null;
    skipped?: string;
    outcome?: Outcome;
    tag?: string;
    currentTags?: string[];
    skipReason?: 'already_done' | 'not_applicable';
};
export default function PricingApp({ getToken, onSave, onBusy, temporary = false }: { getToken: () => Promise<string>; onSave: (run: RunInput) => Promise<void>; onBusy: (value: boolean) => void; temporary?: boolean }) {
    const [operation, setOperation] = useState<'discount' | 'restore' | 'manual' | 'increase' | 'tag'>('manual');
    const [shop, setShop] = useState(''), [clientId, setId] = useState(''), [secret, setSecret] = useState(''), [skus, setSkus] = useState(''), [discount, setDiscount] = useState('20'), [basis, setBasis] = useState('original'), [rows, setRows] = useState<Row[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [currency, setCurrency] = useState(''), [connected, setConnected] = useState(false);
    const [salePrice, setSalePrice] = useState('');
    const [beforePrice, setBeforePrice] = useState('');
    const [tag, setTag] = useState('');
    const [dbMessage, setDbMessage] = useState('');
    const runId = useRef('');
    const [increase, setIncrease] = useState('10');
    useEffect(() => { onBusy(busy); }, [busy, onBusy]);
    const invalidate = () => { setRows([]); setMessage(''); setDbMessage(''); runId.current = ''; };
    const outcomeForError = (error: unknown): Outcome => (error as { code?: string })?.code === 'SKU_NOT_FOUND' ? 'not_found' : 'error';
    async function persist(currentRows: Row[]) {
      if (temporary) { setDbMessage('وضع مؤقت: النتائج متاحة للنسخ هنا، ولا تُحفظ في Firebase.'); return; }
      if (!runId.current) return;
      setDbMessage('جاري حفظ النتائج في Firebase…');
      try { await onSave({ id: runId.current, shop, operation, tag: operation === 'tag' ? tag : '', rows: currentRows }); setDbMessage('تم حفظ النتائج في Firebase'); }
      catch { setDbMessage('لم يُحفظ السجل في Firebase. النتائج المحلية متاحة أدناه؛ يمكنك إعادة محاولة الحفظ.'); }
    }
    async function api(data: object) { const r = await fetch('/api/shopify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` }, body: JSON.stringify({ shop, clientId, secret, ...(operation === 'discount' ? { discount, basis } : {}), ...(operation === 'manual' ? { salePrice, beforePrice } : {}), ...(operation === 'increase' ? { increase } : {}), ...(operation === 'tag' ? { tag } : {}), operation, ...data }) }); const body = await r.json() as {
        error?: string; code?: string;
        currency: string;
        name: string;
        row: Row;
        status: string;
    }; if (!r.ok)
        throw Object.assign(new Error(body.error || 'تعذر إكمال الطلب'), { code: body.code }); return body; }
    async function connect() { setBusy(true); setMessage('جاري ربط المتجر…'); try {
        const d = await api({ action: 'connect' });
        setSecret('');
        setConnected(true);
        setCurrency(d.currency);
        setMessage(`متصل بـ ${d.name}`);
    }
    catch (e) {
        setMessage((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    async function preview() { setBusy(true); setRows([]); const list = [...new Set(skus.split(/[\n,،]+/).map(s => s.trim()).filter(Boolean))]; try {
        if (!list.length)
            throw Error('اكتب SKU واحد على الأقل');
        if (list.length > 500)
            throw Error('الحد الأقصى 500 SKU في الدفعة');
        if (operation === 'discount' && (!Number.isFinite(+discount) || +discount <= 0 || +discount >= 100))
            throw Error('أدخل نسبة أكبر من صفر وأقل من 100');
        if (operation === 'manual' && (!salePrice.trim() || !Number.isFinite(+salePrice) || +salePrice <= 0)) throw Error('أدخل سعر البيع النهائي، أكبر من صفر');
        if (operation === 'increase' && (!Number.isFinite(+increase) || +increase <= 0)) throw Error('أدخل نسبة زيادة أكبر من صفر');
        if (operation === 'tag' && (!tag.trim() || /[,،\r\n]/.test(tag))) throw Error('أدخل تاجًا واحدًا بدون فواصل');
        runId.current = crypto.randomUUID();
        const previewRows: Row[] = list.map(sku => ({ sku, outcome: 'pending' }));
        setRows([...previewRows]);
        for (let i = 0; i < list.length; i++) {
            setMessage(`معاينة ${i + 1} من ${list.length}`);
            try {
                const d = await api({ action: 'preview', sku: list[i] });
                previewRows[i] = { ...d.row, outcome: d.row.skipped ? d.row.skipReason === 'already_done' ? 'unchanged' : 'skipped' : 'ready' }; setRows([...previewRows]);
            }
            catch (e) {
                previewRows[i] = { sku: list[i], error: (e as Error).message, outcome: outcomeForError(e) }; setRows([...previewRows]);
            }
        }
        setMessage('راجع المعاينة، ثم طبّق الصفوف الجاهزة فقط.');
        await persist(previewRows);
    }
    catch (e) {
        setMessage((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    async function apply() { setBusy(true); let finalRows = [...rows]; const ready = rows.filter(r => r.id && !r.error && !r.status && !r.skipped); for (let i = 0; i < ready.length; i++) {
        const row = ready[i];
        setMessage(`تطبيق ${i + 1} من ${ready.length}`);
        try {
            const d = await api({ action: 'apply', row });
            finalRows = finalRows.map(r => r.sku === row.sku ? { ...r, status: d.status, outcome: 'success' } : r); setRows([...finalRows]);
        }
        catch (e) {
            finalRows = finalRows.map(r => r.sku === row.sku ? { ...r, status: 'لم يتم تأكيد التنفيذ: ' + (e as Error).message, outcome: outcomeForError(e) } : r); setRows([...finalRows]);
        }
    } setMessage('انتهت الدفعة. راجع حالة كل صف؛ عند تعذر تأكيد طلب، راجع Shopify قبل إعادة المحاولة.'); await persist(finalRows); setBusy(false); }
    async function disconnect() { setBusy(true); try {
        await api({ action: 'disconnect', discount: 20 });
        setConnected(false);
        setSecret('');
        invalidate();
    }
    catch (e) {
        setMessage((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    const ready = rows.filter(r => r.id && !r.error && !r.status && !r.skipped).length;
    return <main dir="rtl">
    <header>
    <div className="brand">
    <span className="logo">%</span>
    <div>إدارة Shopify بالـSKU<small>الأسعار والتاجات</small>
    </div>
    </div>
    <span className="badge">{connected ? 'المتجر متصل' : 'ابدأ بربط متجرك'}</span>
    </header>
    <section className="intro">
    <h1>إدارة الأسعار والتاجات</h1>
    <p>اربط المتجر، اختَر العملية، ثم راجع التغييرات قبل تطبيقها على الـSKUs المحددة فقط.</p>
    </section>    <div className="workspace">
    <aside className="panel">
    <div className="section-title">
    <b className="step">01</b>
    <h2>ربط المتجر</h2>
    </div>
    <fieldset disabled={busy || connected}>
    <label>دومين Shopify<input dir="ltr" value={shop} onChange={e => setShop(e.target.value)} placeholder="your-store.myshopify.com" spellCheck={false} autoComplete="off"/>
    </label>
    <label>Client ID<input dir="ltr" value={clientId} onChange={e => setId(e.target.value)} autoComplete="off"/>
    </label>
    <label>Client Secret<input dir="ltr" type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="new-password"/>
    </label>
    </fieldset>{!connected ? <button disabled={busy || !shop || !clientId || !secret} onClick={connect}>ربط وتوليد التوكن</button> : <button className="secondary" disabled={busy} onClick={disconnect}>فصل المتجر</button>}<p className="hint">للتطبيقات المثبتة على متجرك، ضمن نفس مؤسسة Shopify. الصلاحيات المطلوبة: read_products وwrite_products.</p>
    <div className="privacy">بيانات الربط محفوظة مشفّرة في كوكي محمية بمتصفحك لمدة تصل إلى 24 ساعة. لا تُحفظ في قاعدة بيانات. فصل المتجر يمسح الجلسة من المتصفح.</div>
    </aside>
    <section className="panel">
    <div className="section-title">
    <b className="step">02</b>
    <h2>تحديد العملية والمنتجات</h2>
    </div>
    <fieldset disabled={busy}>
    <label>العملية<select value={operation} onChange={e => { setOperation(e.target.value as 'discount' | 'restore' | 'manual' | 'increase' | 'tag'); invalidate(); }}>
<option value="manual">تحديد سعر قبل وبعد / سعر بيع فقط</option><option value="discount">خصم بنسبة</option><option value="increase">زيادة سعر البيع بنسبة</option>
<option value="tag">إضافة تاج للمنتجات</option><option value="restore">إلغاء الخصم واسترجاع السعر الأصلي</option>
</select></label>
<label>الـSKUs المطلوبة<textarea dir="ltr" rows={7} placeholder={'SKU-001\nSKU-002\nSKU-003'} value={skus} onChange={e => { setSkus(e.target.value); invalidate(); }}/>
    </label>
    <span className="hint">كود في كل سطر أو افصل بفاصلة • حتى 500 كود</span>
    {operation === 'tag' ? <><label>التاج المطلوب<input value={tag} maxLength={255} placeholder="مثال: Summer" onChange={e => { setTag(e.target.value); invalidate(); }}/></label><p className="privacy">التاج يُضاف للمنتج الأساسي المرتبط بالـSKU، وليس للمقاس أو اللون وحده. التاجات الحالية تظل كما هي.</p></> : operation === 'discount' ? <div className="settings">
    <label>نسبة الخصم %<input type="number" min="0.01" max="99.99" step="0.01" value={discount} onChange={e => { setDiscount(e.target.value); invalidate(); }}/>
    </label>
    <label>حساب الخصم من<select value={basis} onChange={e => { setBasis(e.target.value); invalidate(); }}>
    <option value="original">السعر الأصلي إن كان أعلى من الحالي</option>
    <option value="current">سعر البيع الحالي</option>
    </select>
    </label>
    </div> : (operation === 'manual' || operation === 'increase') ? <>
<div className="settings">
{operation === 'manual' ? <label>السعر قبل الخصم (اختياري)<input dir="ltr" inputMode="decimal" value={beforePrice} placeholder="مثال: 1000" onChange={e => { setBeforePrice(e.target.value); invalidate(); }}/></label>
: <label>زيادة سعر البيع الحالي %<input dir="ltr" type="number" min="0.01" max="10000" step="0.01" value={increase} onChange={e => { setIncrease(e.target.value); invalidate(); }}/></label>}
{operation === 'manual' && <label>سعر البيع النهائي {currency && `(${currency})`}<input dir="ltr" inputMode="decimal" value={salePrice} placeholder="مثال: 800" onChange={e => { setSalePrice(e.target.value); invalidate(); }}/></label>}
</div>
<p className="hint">{operation === 'manual' ? 'نفس الأسعار لكل الـSKUs المدخلة. اترك السعر قبل الخصم فارغًا لو عايز سعر بيع فقط؛ سعر المقارنة الموجود سيتم مسحه.' : 'نزيد سعر البيع الحالي لكل SKU بالنسبة المحددة: 100 مع زيادة 20% يصبح 120. سعر المقارنة الأعلى من السعر الجديد يظل كما هو؛ غير ذلك يُمسح.'}</p>
</> : <p className="privacy">لو سعر المقارنة أعلى من سعر البيع، هيتحوّل لسعر البيع الأساسي وهيتم مسح سعر المقارنة. المنتجات بدون خصم تفضل زي ما هي.</p>}
    </fieldset>
    <button disabled={busy || !connected || !skus.trim()} onClick={preview}>معاينة التغييرات</button>
    </section>
    </div>
    <section className="panel results">
    <div className="results-head">
    <div className="section-title">
    <b className="step">03</b>
    <h2>مراجعة وتطبيق</h2>
    </div>
    <span className="badge">{ready} جاهز للتطبيق</span>
    </div>
    <p role="status" className="message">{message || 'لم تتم معاينة أي منتجات بعد.'}</p>{rows.length > 0 ? <>
        <div className="table-wrap">
        <table>
        <thead>
        <tr>
        <th>SKU / المنتج</th>
        {operation === 'tag' ? <><th>التاجات الحالية</th><th>التاج المطلوب</th></> : <><th>البيع الحالي</th>
        <th>قبل الخصم الحالي</th><th>قبل الخصم الجديد</th>
        <th>سعر البيع الجديد</th></>}
        <th>الحالة</th>
        </tr>
        </thead>
        <tbody>{rows.map(r => <tr key={r.sku}>
            <td>
            <strong dir="ltr">{r.sku}</strong>
            <small>{r.title}</small>
            </td>
            {operation === 'tag' ? <><td>{r.currentTags?.join('، ') || '—'}</td><td>{r.tag || tag}</td></> : <><td>{r.price ?? '—'}</td>
            <td>{r.compareAtPrice ?? '—'}</td><td>{r.error ? '—' : r.skipped ? (r.compareAtPrice ?? '—') : operation === 'restore' ? 'سيُمسح' : operation === 'discount' ? r.base : (r.newCompareAtPrice ?? 'سيُمسح')}</td>
            <td className="newprice">{r.newPrice ?? '—'}</td></>}
            <td>{r.error || r.status || r.skipped || 'جاهز'}</td>
            </tr>)}</tbody>
        </table>
        </div>
        <div className="applybar">
        <p>{operation === 'tag' ? 'التاجات تُضاف للمنتج الأساسي.' : `الأسعار بـ ${currency}.`} خليك فاتح الصفحة لحد انتهاء التطبيق. الأكواد المفقودة أو المكررة لن تُعدّل.</p>
        <button disabled={busy || !ready} onClick={apply}>تطبيق التغييرات على {ready} SKU</button>
        </div>
        </> : <div className="empty">
        <span>≡</span>
        <h3>هنا تظهر التغييرات قبل تطبيقها</h3>
        <p>باقي المنتجات تفضل زي ما هي.</p>
        </div>}
    {rows.length > 0 && <><ResultFields rows={rows}/><p role="status" className="hint">{dbMessage}</p>{!temporary && <button className="secondary" disabled={busy} onClick={() => persist(rows)}>إعادة حفظ السجل</button>}</>}
    </section>
    <footer>تحديث أسعار المتغيرات المحددة • أسعار المتجر الأساسية، وليست أسعار الأسواق المخصصة</footer>
    </main>;
}





