import { supabase } from '../lib/supabase';

export type PaymentProvider = 'lemonsqueezy' | 'stripe' | 'mercadopago' | 'yape_plin';

export interface AuthUserRef {
  id: string;
  email: string;
}

export interface ProSubscriptionState {
  userId: string;
  email: string;
  accessCode: string;
  provider: PaymentProvider;
  amountUsd: number;
  activatedAt: string;
  expiresAt: string;
  syncedToCloud: boolean;
}

const STORAGE_KEY = 'cv_pro_subscription_v2';

export const PRO_MONTHLY_PRICE_USD = 5.0;
export const PRO_MONTHLY_PRICE_PEN = 19.0;

export const YAPE_PLIN_CONFIG = {
  number:
    (import.meta.env.VITE_YAPE_PLIN_NUMBER as string | undefined)?.trim() || '927885314',
  holder:
    (import.meta.env.VITE_YAPE_PLIN_HOLDER as string | undefined)?.trim() || 'CourtVision Perú',
  whatsapp:
    (import.meta.env.VITE_YAPE_PLIN_WHATSAPP as string | undefined)?.trim() || '51927885314',
};

const DEFAULT_LEMONSQUEEZY_URL =
  'https://appsubscription.lemonsqueezy.com/checkout/buy/c8c5ec5d-1da0-483a-a37b-1ba5028fa4df';

export const CHECKOUT_URLS: Partial<Record<PaymentProvider, string>> = {
  lemonsqueezy:
    (import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL as string | undefined)?.trim() ||
    DEFAULT_LEMONSQUEEZY_URL,
  stripe: (import.meta.env.VITE_STRIPE_CHECKOUT_URL as string | undefined)?.trim() || undefined,
  mercadopago:
    (import.meta.env.VITE_MERCADOPAGO_CHECKOUT_URL as string | undefined)?.trim() || undefined,
};

export function getStoredSubscription(userId?: string | null): ProSubscriptionState | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProSubscriptionState;
    if (!parsed?.expiresAt || !parsed?.accessCode || parsed.userId !== userId) {
      return null;
    }
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
    localStorage.removeItem('cv_pro_subscription_v1');
    localStorage.removeItem('cv_pro_pending_email_v1');
  } catch {
    // Ignore storage errors
  }
}

export function getRemainingProDays(sub: ProSubscriptionState | null): number {
  if (!sub) return 0;
  const diff = new Date(sub.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

interface SubRpcRow {
  email: string;
  access_code: string;
  provider: PaymentProvider;
  amount_usd: number;
  starts_at: string;
  expires_at: string;
  test_mode?: boolean;
}

function rowToState(row: SubRpcRow, userId: string): ProSubscriptionState {
  return {
    userId,
    email: row.email,
    accessCode: row.access_code,
    provider: row.provider ?? 'lemonsqueezy',
    amountUsd: Number(row.amount_usd ?? PRO_MONTHLY_PRICE_USD),
    activatedAt: row.starts_at,
    expiresAt: row.expires_at,
    syncedToCloud: true,
  };
}

export async function syncSubscriptionForUser(
  user: AuthUserRef | null,
): Promise<ProSubscriptionState | null> {
  if (!user) {
    clearProSubscription();
    return null;
  }

  try {
    const { data, error } = await supabase.rpc('get_my_pro_subscription');
    if (error) {
      return getStoredSubscription(user.id);
    }

    const row = Array.isArray(data)
      ? (data[0] as SubRpcRow | undefined)
      : (data as SubRpcRow | null);

    if (!row || !row.access_code) {
      clearProSubscription();
      return null;
    }

    const fresh = rowToState(row, user.id);
    saveStoredSubscription(fresh);
    return fresh;
  } catch {
    return getStoredSubscription(user.id);
  }
}

export async function claimProAccessCode(
  code: string,
  user: AuthUserRef | null,
): Promise<ProSubscriptionState | null> {
  if (!user) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;

  try {
    const { data, error } = await supabase.rpc('check_pro_access', {
      p_lookup: trimmed,
    });
    if (error) return null;

    const row = Array.isArray(data)
      ? (data[0] as SubRpcRow | undefined)
      : (data as SubRpcRow | null);
    if (!row || !row.access_code || row.test_mode) return null;

    const synced = rowToState(row, user.id);
    saveStoredSubscription(synced);
    return synced;
  } catch {
    return null;
  }
}

export interface YapePlinRequestResult {
  status: 'pending' | 'approved' | 'rejected';
  accessCode: string | null;
  message: string;
  whatsappUrl: string;
  subscription?: ProSubscriptionState | null;
}

export function buildYapePlinWhatsappUrl(
  email: string,
  operationCode: string,
  senderName?: string,
): string {
  const digits = YAPE_PLIN_CONFIG.whatsapp.replace(/\D/g, '') || '51927885314';
  const text = [
    'Hola! Acabo de realizar el pago de S/ 19.00 por Yape/Plin para CourtVision PRO (30 días).',
    `Correo de cuenta: ${email.trim().toLowerCase()}`,
    `N° Operación: ${operationCode.trim().toUpperCase()}`,
    senderName?.trim() ? `Titular: ${senderName.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export async function submitYapePlinActivationRequest(
  user: AuthUserRef,
  operationCode: string,
  senderName = '',
): Promise<YapePlinRequestResult> {
  const cleanEmail = user.email.trim().toLowerCase();
  const cleanOp = operationCode.trim().toUpperCase();
  const cleanSender = senderName.trim();
  const whatsappUrl = buildYapePlinWhatsappUrl(cleanEmail, cleanOp, cleanSender);

  if (cleanOp.startsWith('CVPRO-')) {
    const found = await claimProAccessCode(cleanOp, user);
    if (found) {
      return {
        status: 'approved',
        accessCode: found.accessCode,
        message: 'Código CVPRO vinculado a tu cuenta. Plan PRO activo por 30 días.',
        whatsappUrl,
        subscription: found,
      };
    }
  }

  const { data, error } = await supabase.rpc('submit_yape_plin_request', {
    p_email: cleanEmail,
    p_operation_code: cleanOp,
    p_sender_name: cleanSender,
  });

  if (error) {
    throw new Error(error.message || 'No se pudo registrar la operación.');
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    status?: 'pending' | 'approved' | 'rejected';
    access_code?: string | null;
    message?: string;
  };
  const status = row?.status ?? 'pending';
  const accessCode = row?.access_code ?? null;
  let subscription: ProSubscriptionState | null = null;
  if (status === 'approved') {
    subscription = await syncSubscriptionForUser(user);
  }

  return {
    status,
    accessCode,
    message:
      row?.message ||
      'Operación registrada en tu cuenta (S/ 19.00). Envía tu captura por WhatsApp; al aprobarse tu cuenta subirá a PRO.',
    whatsappUrl,
    subscription,
  };
}
