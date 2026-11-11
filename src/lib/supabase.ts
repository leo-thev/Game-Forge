import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type GameforgeSupabase = SupabaseClient;

export function createSupabaseClient(): GameforgeSupabase | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
