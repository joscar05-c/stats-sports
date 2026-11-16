import { supabase } from '../lib/supabase';

export type PaymentProvider = 'lemonsqueezy' | 'stripe' | 'mercadopago' | 'yape_plin' | 'demo';

export interface ProSubscriptionState {
  email: string;
  accessCode: string;
  provider: PaymentProvider;
  amountUsd: number;
  activatedAt: string;
  expiresAt: string;
  testMode?: boolean;
  syncedToCloud: boolean;
}

const STORAGE_KEY = 'cv_pro_subscription_v1';
const PENDING_EMAIL_KEY = 'cv_pro_pending_email_v1';

export const PRO_MONTHLY_PRICE_USD = 5.0;

export const CHECKOUT_URLS: Partial<Record<PaymentProvider, string>> = {
  lemonsqueezy: import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL as string | undefined,
  stripe: import.meta.env.VITE_STRIPE_CHECKOUT_URL as string | undefined,
  mercadopago: import.meta.env.VITE_MERCADOPAGO_CHECKOUT_URL as string | undefined,
};

export function getStoredSubscription(): ProSubscriptionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProSubscriptionState;
    if (!parsed?.expiresAt || !parsed?.accessCode) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSubscription(sub: ProSubscriptionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sub));
    localStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // Ignore storage quota errors
  }
}

export function clearProSubscription(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getPendingCheckoutEmail(): string | null {
  try {
    return localStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setPendingCheckoutEmail(email: string): void {
  try {
    const clean = email.trim().toLowerCase();
    if (clean) localStorage.setItem(PENDING_EMAIL_KEY, clean);
  } catch {
    // Ignore storage errors
  }
}

export function clearPendingCheckoutEmail(): void {
  try {
    localStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getRemainingProDays(sub: ProSubscriptionState | null): number {
  if (!sub) return 0;
  const diff = new Date(sub.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

interface CheckProRow {
  email: string;
  access_code: string;
  provider: PaymentProvider;
  amount_usd: number;
  starts_at: string;
  expires_at: string;
  test_mode?: boolean;
}

function rowToState(row: CheckProRow): ProSubscriptionState {
  return {
    email: row.email,
    accessCode: row.access_code,
    provider: row.provider ?? 'lemonsqueezy',
    amountUsd: Number(row.amount_usd ?? PRO_MONTHLY_PRICE_USD),
    activatedAt: row.starts_at,
    expiresAt: row.expires_at,
    testMode: Boolean(row.test_mode),
    syncedToCloud: true,
  };
}

export async function verifyProSubscriptionByEmailOrCode(
  query: string,
): Promise<ProSubscriptionState | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const { data, error } = await supabase.rpc('check_pro_access', {
      p_lookup: trimmed,
    });
    if (error) return null;

    const row = Array.isArray(data) ? (data[0] as CheckProRow | undefined) : (data as CheckProRow | null);
    if (!row || !row.access_code) return null;

    const synced = rowToState(row);
    saveStoredSubscription(synced);
    return synced;
  } catch {
    return null;
  }
}

export async function syncCurrentSubscriptionFromCloud(): Promise<ProSubscriptionState | null> {
  const local = getStoredSubscription();
  if (local) {
    try {
      const { data, error } = await supabase.rpc('check_pro_access', {
        p_lookup: local.accessCode,
      });
      if (error) return local;
      const row = Array.isArray(data)
        ? (data[0] as CheckProRow | undefined)
        : (data as CheckProRow | null);
      if (!row || !row.access_code) {
        clearProSubscription();
        return null;
      }
      const fresh = rowToState(row);
      saveStoredSubscription(fresh);
      return fresh;
    } catch {
      return local;
    }
  }

  const pendingEmail = getPendingCheckoutEmail();
  if (pendingEmail) {
    return verifyProSubscriptionByEmailOrCode(pendingEmail);
  }
  return null;
}
