import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced in the browser console during setup if .env is missing. Placeholders below
  // keep the static build from throwing; real values are inlined at build/run time.
  console.warn('Supabase env vars missing — set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
