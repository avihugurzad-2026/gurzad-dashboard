export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const DEMO = !(SUPABASE_URL && SUPABASE_ANON_KEY);
export const DEMO_OTP = '123456';
