import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[CourtVision] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en .env.local',
  );
}

export const supabaseUrlResolved =
  supabaseUrl ?? 'https://dowxayyvtghtjkctasfn.supabase.co';
export const supabaseKeyResolved =
  supabaseKey ?? 'sb_publishable_ofEQ4jJ_O8ziwbOemySWiA_stfFYEhE';

export const supabase = createClient(supabaseUrlResolved, supabaseKeyResolved);

const CACHE_PREFIX = 'cv_cache_v1_';

export function clearOfflineCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Network-first fetch with localStorage fallback so the PWA keeps working
 * when the user opens it in low-signal arenas or offline.
 */
export async function withOfflineCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  try {
    const fresh = await fetcher();
    try {
      localStorage.setItem(
        `${CACHE_PREFIX}${cacheKey}`,
        JSON.stringify({ ts: Date.now(), data: fresh }),
      );
    } catch {
      // Ignore storage quota errors cleanly
    }
    return { data: fresh, fromCache: false };
  } catch (err) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${cacheKey}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { data: T };
        return { data: parsed.data, fromCache: true };
      }
    } catch {
      // Corrupt cache ignored
    }
    throw err;
  }
}
