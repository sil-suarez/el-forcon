import { createClient } from '@supabase/supabase-js';
import { createMockSupabaseClient } from './mockSupabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const hasRealSupabase = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasRealSupabase) {
  console.warn(
    '[AI Studio] Supabase env vars not configured — using in-memory mock client'
  );
}

export const isSupabaseConfigured = true;

export const supabase = hasRealSupabase
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : createMockSupabaseClient();
