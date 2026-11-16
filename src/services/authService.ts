import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface AdminYapeRequestRow {
  request_id: number;
  user_id: string | null;
  email: string;
  operation_code: string;
  sender_name: string | null;
  amount_pen: number;
  status: 'pending' | 'approved' | 'rejected';
  access_code: string | null;
  created_at: string;
}

function userToFallbackProfile(user: User): UserProfile {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    null;
  const avatarUrl =
    (typeof meta.avatar_url === 'string' && meta.avatar_url.trim()) ||
    (typeof meta.picture === 'string' && meta.picture.trim()) ||
    null;

  return {
    id: user.id,
    email: (user.email ?? '').toLowerCase(),
    fullName,
    avatarUrl,
    isAdmin: false,
  };
}

export async function fetchUserProfile(user: User | null): Promise<UserProfile | null> {
  if (!user) return null;
  const fallback = userToFallbackProfile(user);

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!error && data) {
      return {
        id: data.id,
        email: data.email || fallback.email,
        fullName: data.full_name ?? fallback.fullName,
        avatarUrl: data.avatar_url ?? fallback.avatarUrl,
        isAdmin: Boolean(data.is_admin),
      };
    }

    // Ensure profile row exists if user signed up before migration
    const { error: upsertErr } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        email: fallback.email,
        full_name: fallback.fullName,
        avatar_url: fallback.avatarUrl,
      },
      { onConflict: 'id' },
    );
    if (!upsertErr) {
      return fallback;
    }
  } catch {
    // Return auth fallback cleanly on transient errors
  }
  return fallback;
}

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = window.location.origin;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        prompt: 'select_account',
      },
    },
  });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string): Promise<User | null> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data.user ?? null;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
): Promise<{ user: User | null; needsEmailConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: window.location.origin,
      data: {
        full_name: fullName.trim() || undefined,
      },
    },
  });
  if (error) throw error;
  return {
    user: data.user ?? null,
    needsEmailConfirmation: Boolean(data.user && !data.session),
  };
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

export async function signOutAccount(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function translateAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Debes confirmar tu correo electrónico antes de iniciar sesión (revisa tu bandeja o spam).';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'Este correo ya está registrado. Inicia sesión en la pestaña "Iniciar sesión".';
  }
  if (lower.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Demasiados intentos seguidos. Espera un minuto e intenta nuevamente.';
  }
  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return 'Google Sign-In aún no está activado en Supabase Auth (Authentication → Providers → Google).';
  }
  return raw || 'No se pudo completar la autenticación.';
}

export async function adminListYapeRequests(): Promise<AdminYapeRequestRow[]> {
  const { data, error } = await supabase.rpc('admin_list_yape_requests');
  if (error) throw error;
  return (data ?? []) as AdminYapeRequestRow[];
}

export async function adminReviewYapeRequest(
  requestId: number,
  decision: 'approved' | 'rejected',
): Promise<{ request_id: number; status: string; access_code: string | null }> {
  const { data, error } = await supabase.rpc('admin_review_yape_request', {
    p_request_id: requestId,
    p_decision: decision,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { request_id: number; status: string; access_code: string | null };
}
