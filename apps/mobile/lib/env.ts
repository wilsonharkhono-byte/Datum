function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var ${name}. Set it in the Expo build env.`);
  return value;
}

export const SUPABASE_URL = required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Base URL of the DATUM web app — used by the mobile app to call server-side
 * API routes (e.g. /api/areas/suggest) that require Claude/Anthropic.
 * OPTIONAL: when unset, AI-powered features are hidden rather than broken.
 */
export const WEB_BASE_URL: string | undefined = process.env.EXPO_PUBLIC_WEB_BASE_URL;
