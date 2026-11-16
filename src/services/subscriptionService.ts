import { supabase } from '../lib/supabase';

export type PaymentProvider = 'lemonsqueezy' | 'stripe' | 'mercadopago' | 'yape_plin';

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
const PENDING_EMAIL_KEY = 'cv_pro_pending_email_v1';
const YAPE_REQUESTS_KEY = 'cv_yape_requests_v1';

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

    const row = Array.isArray(data)
      ? (data[0] as CheckProRow | undefined)
      : (data as CheckProRow | null);
    if (!row || !row.access_code || row.test_mode) return null;

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
      if (row && row.access_code && !row.test_mode) {
        const fresh = rowToState(row);
        saveStoredSubscription(fresh);
        return fresh;
      }
      clearProSubscription();
      return null;
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
    `Correo: ${email.trim().toLowerCase()}`,
    `N° Operación: ${operationCode.trim().toUpperCase()}`,
    senderName?.trim() ? `Titular: ${senderName.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export async function submitYapePlinActivationRequest(
  email: string,
  operationCode: string,
  senderName = '',
): Promise<YapePlinRequestResult> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanOp = operationCode.trim().toUpperCase();
  const cleanSender = senderName.trim();
  const whatsappUrl = buildYapePlinWhatsappUrl(cleanEmail, cleanOp, cleanSender);

  if (cleanOp.startsWith('CVPRO-')) {
    const found = await verifyProSubscriptionByEmailOrCode(cleanOp);
    if (found) {
      return {
        status: 'approved',
        accessCode: found.accessCode,
        message: 'Código CVPRO validado correctamente. Modo PRO desbloqueado por 30 días.',
        whatsappUrl,
        subscription: found,
      };
    }
  }

  try {
    const { data, error } = await supabase.rpc('submit_yape_plin_request', {
      p_email: cleanEmail,
      p_operation_code: cleanOp,
      p_sender_name: cleanSender,
    });

    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as {
        status?: 'pending' | 'approved' | 'rejected';
        access_code?: string | null;
        message?: string;
      };
      const status = row?.status ?? 'pending';
      const accessCode = row?.access_code ?? null;
      let subscription: ProSubscriptionState | null = null;
      if (status === 'approved' && accessCode) {
        subscription = await verifyProSubscriptionByEmailOrCode(accessCode);
      } else if (cleanEmail) {
        setPendingCheckoutEmail(cleanEmail);
      }
      return {
        status,
        accessCode,
        message:
          row?.message ||
          'Solicitud registrada (S/ 19.00). Envía tu captura por WhatsApp para recibir tu código CVPRO.',
        whatsappUrl,
        subscription,
      };
    }
  } catch {
    // Fall through to resilient local record below
  }

  try {
    const raw = localStorage.getItem(YAPE_REQUESTS_KEY);
    const list = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    list.unshift({
      email: cleanEmail,
      operationCode: cleanOp,
      senderName: cleanSender,
      amountPen: PRO_MONTHLY_PRICE_PEN,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(YAPE_REQUESTS_KEY, JSON.stringify(list.slice(0, 15)));
  } catch {
    // Ignore storage errors
  }

  if (cleanEmail) setPendingCheckoutEmail(cleanEmail);

  return {
    status: 'pending',
    accessCode: null,
    message:
      'Operación guardada (S/ 19.00). Envía el comprobante por WhatsApp o ingresa tu código CVPRO cuando lo recibas.',
    whatsappUrl,
    subscription: null,
  };
}
