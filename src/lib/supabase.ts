import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabasePublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

const DEVICE_KEY = "kiran.device";
const CLAIM_KEY = "kiran.device.registering";
const CLAIM_TTL_MS = 30_000;

let cachedConfig: SupabasePublicConfig | null = null;
let configPromise: Promise<SupabasePublicConfig> | null = null;
let cachedClient: SupabaseClient | null = null;
let cachedClientKey = "";
let inflightRegister: Promise<{ error: unknown }> | null = null;

function readEnvConfigSync(): SupabasePublicConfig {
  const metaEnv =
    typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ? (import.meta as unknown as { env: Record<string, string | undefined> }).env
      : {};
  const nodeEnv = typeof process !== "undefined" && process.env ? process.env : {};

  const supabaseUrl = (
    metaEnv.VITE_SUPABASE_URL ||
    metaEnv.SUPABASE_URL ||
    nodeEnv.VITE_SUPABASE_URL ||
    nodeEnv.SUPABASE_URL ||
    ""
  ).trim();

  const supabaseAnonKey = (
    metaEnv.VITE_SUPABASE_ANON_KEY ||
    metaEnv.SUPABASE_ANON_KEY ||
    nodeEnv.VITE_SUPABASE_ANON_KEY ||
    nodeEnv.SUPABASE_ANON_KEY ||
    ""
  ).trim();

  return { supabaseUrl, supabaseAnonKey };
}

/**
 * Resolves public Supabase URL & anon key from Vite env vars first,
 * falling back to the Express server `/api/auth/config` endpoint when running in browser.
 * Never reads or exposes SUPABASE_SERVICE_ROLE_KEY.
 */
export async function resolveSupabaseConfig(): Promise<SupabasePublicConfig> {
  if (cachedConfig && cachedConfig.supabaseUrl && cachedConfig.supabaseAnonKey) {
    return cachedConfig;
  }

  const envCfg = readEnvConfigSync();
  if (envCfg.supabaseUrl && envCfg.supabaseAnonKey) {
    cachedConfig = envCfg;
    return envCfg;
  }

  if (typeof window === "undefined") {
    return envCfg;
  }

  if (!configPromise) {
    configPromise = fetch("/api/auth/config")
      .then(async (res) => {
        if (!res.ok) return { supabaseUrl: "", supabaseAnonKey: "" };
        const json = (await res.json()) as Partial<SupabasePublicConfig>;
        return {
          supabaseUrl: typeof json.supabaseUrl === "string" ? json.supabaseUrl.trim() : "",
          supabaseAnonKey: typeof json.supabaseAnonKey === "string" ? json.supabaseAnonKey.trim() : "",
        };
      })
      .catch(() => ({ supabaseUrl: "", supabaseAnonKey: "" }))
      .finally(() => {
        configPromise = null;
      });
  }

  const resolved = await configPromise;
  if (resolved.supabaseUrl && resolved.supabaseAnonKey) {
    cachedConfig = resolved;
  }
  return resolved;
}

export async function isSupabaseClientConfigured(): Promise<boolean> {
  const cfg = await resolveSupabaseConfig();
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
}

/**
 * Generates or returns the stable per-browser device identifier sent via `x-kiran-device`.
 */
export function deviceId(): string {
  if (typeof window === "undefined") {
    return "web-server";
  }
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    id = `web-${uuid}`;
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/**
 * Rotates a revoked device ID safely across tabs using compare-and-swap.
 */
export function rotateDeviceId(revokedId?: string): string {
  if (typeof window === "undefined") return "web-server";
  if (revokedId === undefined || window.localStorage.getItem(DEVICE_KEY) === revokedId) {
    window.localStorage.removeItem(DEVICE_KEY);
  }
  return deviceId();
}

export function createConfiguredSupabaseClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  devId = deviceId(),
): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        "x-kiran-device": devId,
      },
    },
  });
}

/**
 * Returns the active Supabase client bound to the current `x-kiran-device` header,
 * rebuilding automatically if the device fingerprint rotates.
 */
export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  const cfg = await resolveSupabaseConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return null;
  }

  const id = deviceId();
  const compositeKey = `${cfg.supabaseUrl}|${cfg.supabaseAnonKey}|${id}`;
  if (!cachedClient || cachedClientKey !== compositeKey) {
    if (cachedClient) {
      void cachedClient.auth.stopAutoRefresh();
    }
    cachedClient = createConfiguredSupabaseClient(cfg.supabaseUrl, cfg.supabaseAnonKey, id);
    cachedClientKey = compositeKey;
  }
  return cachedClient;
}

/**
 * Ensures the active browser device is registered in `public.device` via `app.register_device`.
 */
export function ensureDeviceRegistered(
  status: string | null,
  idUsedForStatus: string,
): Promise<{ error: unknown }> {
  if (typeof window === "undefined") {
    return Promise.resolve({ error: null });
  }

  inflightRegister ??= (async () => {
    if (status === "revoked") {
      rotateDeviceId(idUsedForStatus);
    } else if (status !== null) {
      return { error: null };
    }

    const id = deviceId();
    try {
      const claim = JSON.parse(window.localStorage.getItem(CLAIM_KEY) ?? "null") as {
        id: string;
        at: number;
      } | null;
      if (claim && claim.id === id && Date.now() - claim.at < CLAIM_TTL_MS) {
        return { error: null };
      }
    } catch {
      // Ignore malformed claim entry
    }

    window.localStorage.setItem(CLAIM_KEY, JSON.stringify({ id, at: Date.now() }));
    const client = await getSupabaseClient();
    if (!client) {
      window.localStorage.removeItem(CLAIM_KEY);
      return { error: new Error("Supabase is not configured.") };
    }

    const platform =
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : "web";
    const reg = await client.schema("app").rpc("register_device", {
      p_fingerprint: id,
      p_platform: platform,
      p_label: null,
    });
    if (reg.error) {
      window.localStorage.removeItem(CLAIM_KEY);
    }
    return { error: reg.error };
  })().finally(() => {
    inflightRegister = null;
  });

  return inflightRegister;
}

export async function signInWithSupabaseGoogle(redirectTo?: string): Promise<string> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error("Supabase URL and anon key are not configured.");
  }
  const targetRedirect =
    redirectTo || (typeof window !== "undefined" ? window.location.origin : "");
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: targetRedirect,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data?.url) {
    throw new Error(error?.message || "Could not start Google Sign-In with Supabase.");
  }
  return data.url;
}

export async function signInWithSupabaseEmailOtp(email: string): Promise<void> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error("Supabase URL and anon key are not configured.");
  }
  const cleanEmail = email.trim().toLowerCase();
  const { error } = await client.auth.signInWithOtp({
    email: cleanEmail,
    options: { shouldCreateUser: false },
  });
  if (error) {
    throw new Error(error.message || "Could not send verification code.");
  }
}

export async function verifySupabaseEmailOtp(email: string, token: string): Promise<void> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error("Supabase URL and anon key are not configured.");
  }
  const { error } = await client.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  if (error) {
    throw new Error(error.message || "Invalid or expired verification code.");
  }
}

export async function signOutSupabase(): Promise<void> {
  const client = await getSupabaseClient();
  if (client) {
    await client.auth.signOut();
  }
}

export function karachiTodayIso(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(date);
}

export interface SupabaseMfaStatus {
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
  totpFactorId: string | null;
  verifiedFactorsCount: number;
}

export async function getSupabaseMfaStatus(): Promise<SupabaseMfaStatus> {
  const client = await getSupabaseClient();
  if (!client) {
    return { currentLevel: null, nextLevel: null, totpFactorId: null, verifiedFactorsCount: 0 };
  }
  try {
    const [{ data: aal }, { data: factors }] = await Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
    ]);
    const totpFactors = factors?.totp ?? [];
    const verified = totpFactors.filter((f) => f.status === "verified");
    return {
      currentLevel: (aal?.currentLevel as "aal1" | "aal2" | null) ?? null,
      nextLevel: (aal?.nextLevel as "aal1" | "aal2" | null) ?? null,
      totpFactorId: verified[0]?.id ?? totpFactors[0]?.id ?? null,
      verifiedFactorsCount: verified.length,
    };
  } catch {
    return { currentLevel: null, nextLevel: null, totpFactorId: null, verifiedFactorsCount: 0 };
  }
}

export async function enrollSupabaseTotp(): Promise<{
  factorId: string;
  qrCode: string;
  secret: string;
}> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Kiran Office (${new Date().toISOString().slice(0, 10)})`,
  });
  if (error || !data) {
    throw new Error(error?.message || "Could not start authenticator setup.");
  }
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function verifySupabaseTotpCode(factorId: string, code: string): Promise<void> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }
  const cleanCode = code.replace(/\s+/g, "");
  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code: cleanCode,
  });
  if (error) {
    throw new Error(error.message || "Invalid 6-digit authenticator code.");
  }
}

export function resetSupabaseClientForTests(): void {
  if (cachedClient) {
    void cachedClient.auth.stopAutoRefresh();
  }
  cachedConfig = null;
  configPromise = null;
  cachedClient = null;
  cachedClientKey = "";
  inflightRegister = null;
}

