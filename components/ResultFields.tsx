'use client';
import { useState } from 'react';
import { summarizeResults, type ResultItem } from '../lib/results';

export default function ResultFields({ rows }: { rows: ResultItem[] }) {
  const summary = summarizeResults(rows);
  const [copyMessage, setCopyMessage] = useState('');
  async function copy(values: string[]) {
    try { await navigator.clipboard.writeText(values.join('\n')); setCopyMessage('تم نسخ الـSKUs'); }
    catch { setCopyMessage('تعذر النسخ التلقائي؛ حدد النص داخل الخانة وانسخه يدويًا.'); }
  }
  return <section className="result-fields" aria-label="ملخص النتائج">
    <h3>ملخص النتائج · {summary.completed} مكتمل أو مطابق بالفعل</h3>
    <div className="report-grid">
      <div><label>حصل فيها خطأ أو لم تتم ({summary.incomplete.length})<textarea readOnly dir="ltr" rows={6} value={summary.incomplete.join('\n')} placeholder="لا توجد أكواد"/></label><button className="secondary" disabled={!summary.incomplete.length} onClick={() => copy(summary.incomplete)}>نسخ غير المكتمل</button></div>
      <div><label>لم يتم العثور عليها ({summary.missing.length})<textarea readOnly dir="ltr" rows={6} value={summary.missing.join('\n')} placeholder="لا توجد أكواد"/></label><button className="secondary" disabled={!summary.missing.length} onClick={() => copy(summary.missing)}>نسخ غير الموجود</button></div>
    </div>
    <p className="hint">غير المكتمل يشمل الصفوف التي لم تُطبّق بعد، والأخطاء، والصفوف غير القابلة للعملية. المطلوب الموجود بالفعل لا يُعتبر فشلًا. راجع سبب كل صف في الجدول.</p>
    <p role="status" className="hint">{copyMessage}</p>
  </section>;
}
