import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * The Supabase client, used for authentication only; game data goes through GameClient.
 * null when the project isn't configured, which leaves the app guest-only.
 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
