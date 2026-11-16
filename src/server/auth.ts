import { createClient } from "@supabase/supabase-js";

export function isSupabaseAuthConfigured(): boolean {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  return Boolean(url && anonKey);
}

export async function buildGoogleOAuthUrl(redirectUri: string): Promise<string> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) {
    throw new Error("Supabase auth is not configured on the server.");
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      flowType: "pkce",
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUri,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    throw new Error(error?.message ?? "Could not generate Google OAuth URL.");
  }
  return data.url;
}
