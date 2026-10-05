export const MONTHLY_PRICE = 10;
export type Membership = {
  enabled?: boolean;
  paymentVerified?: boolean;
  amount?: number;
  currency?: string;
  plan?: string;
  expiresAt?: { toMillis(): number } | string | null;
};

export function expiryMillis(member: Membership | null | undefined) {
  const value = member?.expiresAt;
  return typeof value === 'string' ? Date.parse(value) : value?.toMillis() ?? 0;
}

export function canUseApp(admin: boolean, member: Membership | null | undefined, now = Date.now()) {
  return admin || (!!member && member.enabled === true && member.paymentVerified === true
    && member.amount === MONTHLY_PRICE && member.currency === 'USD' && member.plan === 'monthly'
    && expiryMillis(member) > now);
}

/** One calendar month, clamping e.g. January 31 to the last day of February. */
export function extendOneMonth(previousExpiry: number, now = Date.now()) {
  const base = new Date(Math.max(Number.isFinite(previousExpiry) ? previousExpiry : 0, now));
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base;
}
