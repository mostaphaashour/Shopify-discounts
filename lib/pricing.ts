/** Calculate in currency minor units to avoid floating-point price rounding. */
export function calculate(price: string, compare: string | null, discount: number, basis: string, digits: number) {
  if (!Number.isFinite(discount) || discount <= 0 || discount >= 100 || Math.abs(discount * 100 - Math.round(discount * 100)) > 1e-8) {
    throw new Error('نسبة الخصم يجب أن تكون بين 0 و100، وبحد أقصى منزلتين عشريتين');
  }
  if (basis !== 'original' && basis !== 'current') throw new Error('أساس الخصم غير صالح');
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) throw new Error('دقة العملة غير مدعومة');
  const scale = 10n ** BigInt(digits);
  function minorUnits(value: string) {
    if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('سعر غير صالح');
    const [whole, fraction = ''] = value.split('.');
    const padded = fraction.padEnd(digits + 1, '0');
    return BigInt(whole) * scale + BigInt(padded.slice(0, digits) || '0') + (Number(padded[digits]) >= 5 ? 1n : 0n);
  }
  function format(value: bigint) {
    if (digits === 0) return String(value);
    return `${value / scale}.${String(value % scale).padStart(digits, '0')}`;
  }
  const current = minorUnits(price);
  const original = compare === null ? 0n : minorUnits(compare);
  if (current <= 0n) throw new Error('سعر البيع غير صالح للخصم');
  const base = basis === 'original' && original > current ? original : current;
  const rate = BigInt(Math.round(discount * 100));
  const result = (base * (10000n - rate) + 5000n) / 10000n;
  if (result <= 0n || result >= base) throw new Error('الخصم بعد التقريب غير صالح لعملة المتجر');
  return { base: format(base), newPrice: format(result) };
}

export type PriceSettings = {
  operation: 'manual' | 'increase';
  salePrice?: string;
  beforePrice?: string;
  increase?: number;
};

/** Explicit prices must already fit the store currency; percentage results round half up. */
export function calculateTarget(currentPrice: string, settings: PriceSettings, digits: number, currentCompare: string | null = null) {
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) throw new Error('دقة العملة غير مدعومة');
  const scale = 10n ** BigInt(digits);
  function units(value: string) {
    const input = value.trim();
    if (!/^\d+(\.\d+)?$/.test(input)) throw new Error('أدخل سعرًا صحيحًا أكبر من صفر');
    const [whole, fraction = ''] = input.split('.');
    if (fraction.slice(digits).replace(/0/g, '')) throw new Error(`العملة تسمح بـ ${digits} منازل عشرية فقط`);
    const amount = BigInt(whole) * scale + BigInt(fraction.slice(0, digits).padEnd(digits, '0') || '0');
    if (amount <= 0n) throw new Error('السعر يجب أن يكون أكبر من صفر');
    return amount;
  }
  function format(value: bigint) {
    return digits ? `${value / scale}.${String(value % scale).padStart(digits, '0')}` : String(value);
  }
  let sale: bigint;
  let before: bigint | null = null;
  if (settings.operation === 'manual') {
    sale = units(settings.salePrice ?? '');
    if (settings.beforePrice?.trim()) before = units(settings.beforePrice);
  } else if (settings.operation === 'increase') {
    const percent = settings.increase;
    if (percent === undefined || !Number.isFinite(percent) || percent <= 0 || percent > 10000
      || Math.abs(percent * 100 - Math.round(percent * 100)) > 1e-8) {
      throw new Error('أدخل نسبة زيادة أكبر من صفر وحتى 10000، وبحد أقصى منزلتين عشريتين');
    }
    const current = units(currentPrice);
    sale = (current * (10000n + BigInt(Math.round(percent * 100))) + 5000n) / 10000n;
    if (sale <= current) throw new Error('الزيادة صغيرة جدًا بعد تقريب العملة');
    if (currentCompare !== null && Number(currentCompare) > 0) {
      const existing = units(currentCompare);
      if (existing > sale) before = existing;
    }
  } else {
    throw new Error('نوع العملية غير صالح');
  }
  if (before !== null && before <= sale) throw new Error('السعر قبل الخصم يجب أن يكون أكبر من سعر البيع');
  return { newPrice: format(sale), newCompareAtPrice: before === null ? null : format(before) };
}

