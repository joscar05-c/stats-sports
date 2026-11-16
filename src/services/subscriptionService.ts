import { supabase } from '../lib/supabase';

export type PaymentProvider = 'lemonsqueezy' | 'stripe' | 'mercadopago' | 'yape_plin' | 'demo';

export interface ProSubscriptionState {
  email: string;
  accessCode: string;
  provider: PaymentProvider;
  amountUsd: number;
  activatedAt: string;
  expiresAt: string;
  syncedToCloud: boolean;
}

const STORAGE_KEY = 'cv_pro_subscription_v1';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const PRO_MONTHLY_PRICE_USD = 5.0;

export const CHECKOUT_URLS: Partial<Record<PaymentProvider, string>> = {
  lemonsqueezy: import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL as string | undefined,
  stripe: import.meta.env.VITE_STRIPE_CHECKOUT_URL as string | undefined,
  mercadopago: import.meta.env.VITE_MERCADOPAGO_CHECKOUT_URL as string | undefined,
};

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i += 1) {
    part1 += chars[Math.floor(Math.random() * chars.length)];
    part2 += chars[Math.floor(Math.random() * chars.length)];
  }
  return `CVPRO-${part1}-${part2}`;
}

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
  } catch {
    // Ignore storage quota errors
  }
}

export function clearProSubscription(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getRemainingProDays(sub: ProSubscriptionState | null): number {
  if (!sub) return 0;
  const diff = new Date(sub.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export async function activateProSubscription(
  emailInput: string,
  provider: PaymentProvider,
): Promise<ProSubscriptionState> {
  const cleanEmail = emailInput.trim().toLowerCase() || 'usuario@courtvision.app';
  const accessCode = generateAccessCode();
  const now = new Date();
  const expires = new Date(now.getTime() + THIRTY_DAYS_MS);

  let syncedToCloud = false;
  try {
    const { error } = await supabase.from('pro_subscriptions').insert({
      email: cleanEmail,
      access_code: accessCode,
      provider,
      amount_usd: PRO_MONTHLY_PRICE_USD,
      status: 'active',
      starts_at: now.toISOString(),
      expires_at: expires.toISOString(),
    });
    if (!error) {
      syncedToCloud = true;
    }
  } catch {
    // Fallback cleanly to localStorage if migration has not been applied yet
  }

  const state: ProSubscriptionState = {
    email: cleanEmail,
    accessCode,
    provider,
    amountUsd: PRO_MONTHLY_PRICE_USD,
    activatedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    syncedToCloud,
  };
  saveStoredSubscription(state);
  return state;
}

export async function verifyProSubscriptionByEmailOrCode(
  query: string,
): Promise<ProSubscriptionState | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const stored = getStoredSubscription();
  if (
    stored &&
    (stored.accessCode.toUpperCase() === trimmed.toUpperCase() ||
      stored.email.toLowerCase() === trimmed.toLowerCase())
  ) {
    return stored;
  }

  try {
    const nowIso = new Date().toISOString();
    const isCode = trimmed.toUpperCase().startsWith('CVPRO-');
    let req = supabase
      .from('pro_subscriptions')
      .select('email, access_code, provider, amount_usd, starts_at, expires_at')
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .order('expires_at', { ascending: false })
      .limit(1);

    req = isCode ? req.eq('access_code', trimmed.toUpperCase()) : req.ilike('email', trimmed);

    const { data, error } = await req.maybeSingle();
    if (error || !data) return null;

    const synced: ProSubscriptionState = {
      email: data.email as string,
      accessCode: data.access_code as string,
      provider: (data.provider as PaymentProvider) ?? 'lemonsqueezy',
      amountUsd: Number(data.amount_usd ?? PRO_MONTHLY_PRICE_USD),
      activatedAt: data.starts_at as string,
      expiresAt: data.expires_at as string,
      syncedToCloud: true,
    };
    saveStoredSubscription(synced);
    return synced;
  } catch {
    return null;
  }
}

export async function syncCurrentSubscriptionFromCloud(): Promise<ProSubscriptionState | null> {
  const local = getStoredSubscription();
  if (!local) return null;
  try {
    const { data, error } = await supabase
      .from('pro_subscriptions')
      .select('email, access_code, provider, amount_usd, starts_at, expires_at, status')
      .eq('access_code', local.accessCode)
      .maybeSingle();

    if (error || !data) return local;
    if (data.status !== 'active' || new Date(data.expires_at as string).getTime() <= Date.now()) {
      clearProSubscription();
      return null;
    }

    const fresh: ProSubscriptionState = {
      email: data.email as string,
      accessCode: data.access_code as string,
      provider: (data.provider as PaymentProvider) ?? local.provider,
      amountUsd: Number(data.amount_usd ?? PRO_MONTHLY_PRICE_USD),
      activatedAt: data.starts_at as string,
      expiresAt: data.expires_at as string,
      syncedToCloud: true,
    };
    saveStoredSubscription(fresh);
    return fresh;
  } catch {
    return local;
  }
}
