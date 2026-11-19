import { registerPlugin } from '@capacitor/core';

export interface NativeGoogleSignInResult {
  idToken: string;
  email?: string | null;
  displayName?: string | null;
}

interface NativeGoogleAuthPlugin {
  signIn(options: { webClientId: string; nonce?: string }): Promise<NativeGoogleSignInResult>;
  signOut(): Promise<void>;
}

export const NativeGoogleAuth = registerPlugin<NativeGoogleAuthPlugin>('NativeGoogleAuth');

/**
 * Generates a raw cryptographic nonce and its SHA-256 hex digest.
 * Google receives the hashed nonce and embeds it inside the ID token,
 * while Supabase verifies the raw nonce against the hashed claim.
 */
export async function createGoogleNoncePair(): Promise<{
  rawNonce: string;
  hashedNonce: string;
}> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const rawNonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  if (typeof crypto.subtle !== 'undefined') {
    const encoded = new TextEncoder().encode(rawNonce);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    const hashedNonce = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    return { rawNonce, hashedNonce };
  }

  return { rawNonce, hashedNonce: rawNonce };
}
