function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var ${name}. Set it in the Expo build env.`);
  return value;
}

export const SUPABASE_URL = required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
