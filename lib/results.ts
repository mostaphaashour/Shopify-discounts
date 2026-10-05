export type Outcome = 'pending' | 'ready' | 'success' | 'unchanged' | 'skipped' | 'error' | 'not_found';
export type ResultItem = { sku: string; outcome?: Outcome };

/** Keep missing SKUs separate from failures and uncompleted work. */
export function summarizeResults(rows: ResultItem[]) {
  const unique = (items: ResultItem[]) => [...new Set(items.map(row => row.sku))];
  return {
    missing: unique(rows.filter(row => row.outcome === 'not_found')),
    incomplete: unique(rows.filter(row => ['pending', 'ready', 'skipped', 'error'].includes(row.outcome ?? 'pending'))),
    completed: rows.filter(row => row.outcome === 'success' || row.outcome === 'unchanged').length,
  };
}
