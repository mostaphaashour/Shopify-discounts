'use client';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { firebaseClient } from './firebase-client';
import { summarizeResults, type Outcome } from './results';

export type SavedRow = {
  sku: string; outcome?: Outcome; error?: string; status?: string; skipped?: string;
  price?: string; compareAtPrice?: string | null; newPrice?: string; newCompareAtPrice?: string | null; base?: string;
};
export type RunInput = { id: string; shop: string; operation: string; rows: SavedRow[]; tag?: string };
export type RunSummary = { id: string; shop: string; operation: string; total: number; completed: number; missing: number; incomplete: number; state: string };

export async function saveRun(uid: string, run: RunInput) {
  const { db } = firebaseClient();
  const summary = summarizeResults(run.rows);
  const root = doc(db, 'users', uid, 'runs', run.id);
  const metadata = { shop: run.shop, operation: run.operation, tag: run.tag ?? '', total: run.rows.length,
    completed: summary.completed, missing: summary.missing.length, incomplete: summary.incomplete.length,
    updatedAt: serverTimestamp() };
  await setDoc(root, { ...metadata, state: 'saving' });
  // Separate row documents keep even 500 long SKUs below Firestore's per-document limit.
  for (let start = 0; start < run.rows.length; start += 200) {
    const batch = writeBatch(db);
    run.rows.slice(start, start + 200).forEach((row, offset) => {
      batch.set(doc(root, 'rows', String(start + offset).padStart(4, '0')), {
        sku: row.sku, outcome: row.outcome ?? 'pending',
        detail: (row.error || row.status || row.skipped || '').slice(0, 500),
        price: row.price ?? null, compareAtPrice: row.compareAtPrice ?? null,
        newPrice: row.newPrice ?? null, newCompareAtPrice: (row.skipped || run.operation === 'tag') ? row.compareAtPrice ?? null : row.newCompareAtPrice ?? (run.operation === 'discount' ? row.base ?? null : null),
      });
    });
    await batch.commit();
  }
  await setDoc(root, { ...metadata, state: 'saved' });
}

export async function listRuns(uid: string): Promise<RunSummary[]> {
  const { db } = firebaseClient();
  const snapshot = await getDocs(query(collection(db, 'users', uid, 'runs'), orderBy('updatedAt', 'desc'), limit(10)));
  return snapshot.docs.map(item => ({ ...item.data(), id: item.id } as RunSummary));
}

export async function readRunRows(uid: string, id: string) {
  const snapshot = await getDocs(collection(firebaseClient().db, 'users', uid, 'runs', id, 'rows'));
  return snapshot.docs.map(item => item.data() as { sku: string; outcome: Outcome; detail: string });
}

