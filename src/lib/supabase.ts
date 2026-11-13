import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type GameforgeSupabase = SupabaseClient;

export function getSupabaseConnectionConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function createSupabaseClient(): GameforgeSupabase | null {
  const config = getSupabaseConnectionConfig();
  if (!config) return null;
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
