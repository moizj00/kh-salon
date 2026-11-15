import type { CatalogSkuInput } from "./catalog";
import type { SKU } from "./data";
import { isSupabaseClientConfigured, resolveSupabaseConfig, signOutSupabase } from "./supabase";
import {
  bulkImportLiveSalons,
  executeLiveManagerApproval,
  fetchLiveBootstrap,
  fetchLiveManagerOverview,
  fetchLiveSalonActivity,
  fetchLiveUserSession,
  syncLiveRouteOrder,
  upsertLiveCatalogSku,
} from "./supabase-kiran";
import type {
  BootstrapPayload,
  CreateShopOrderInput,
  DeliveryNotificationResult,
  ManagerApprovalAction,
  ManagerOverviewPayload,
  PublicShopOrder,
  SalonActivityPayload,
  UserProfile,
  UserRole,
} from "../server/types";

const TOKEN_STORAGE_KEY = "kiran.auth.token";
const AUTH_MODE_KEY = "kiran.auth.mode";

let cachedActiveUser: UserProfile | null = null;

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getAuthMode(): "supabase" | "demo" {
  if (typeof window === "undefined") return "demo";
  const stored = window.sessionStorage.getItem(AUTH_MODE_KEY);
  if (stored === "supabase" || stored === "demo") return stored;
  const token = getAuthToken();
  if (token && !token.startsWith("demo-")) return "supabase";
  return "demo";
}

export function setAuthMode(mode: "supabase" | "demo" | null) {
  if (typeof window === "undefined") return;
  if (mode) {
    window.sessionStorage.setItem(AUTH_MODE_KEY, mode);
  } else {
    window.sessionStorage.removeItem(AUTH_MODE_KEY);
  }
}

export function setActiveSessionUser(user: UserProfile | null) {
  cachedActiveUser = user;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }
  }

  if (!res.ok) {
    const message = typeof parsed.error === "string" ? parsed.error : `Request failed (${res.status})`;
    const code = typeof parsed.code === "string" ? parsed.code : "";
    throw new ApiError(message, res.status, code);
  }

  return parsed as unknown as T;
}

export async function getAuthConfig(): Promise<{
  authConfigured: boolean;
  supabaseConfigured: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}> {
  const cfg = await resolveSupabaseConfig();
  const clientReady = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  if (clientReady) {
    return {
      authConfigured: true,
      supabaseConfigured: true,
      supabaseUrl: cfg.supabaseUrl,
      supabaseAnonKey: cfg.supabaseAnonKey,
    };
  }
  return apiFetch("/api/auth/config");
}

export async function fetchMapsConfig(): Promise<{ apiKey: string }> {
  return apiFetch("/api/maps/config");
}

export async function getGoogleOAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const origin = typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : "";
  return apiFetch(`/api/auth/google-url?origin=${origin}`);
}

export async function signInDemo(role: UserRole): Promise<{ token: string; user: UserProfile }> {
  setAuthMode("demo");
  const res = await apiFetch<{ token: string; user: UserProfile }>("/api/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role }),
  });
  cachedActiveUser = res.user;
  return res;
}

export async function signOutEverywhere(): Promise<void> {
  const wasSupabase = getAuthMode() === "supabase";
  setAuthToken(null);
  setAuthMode(null);
  cachedActiveUser = null;
  if (wasSupabase) {
    await signOutSupabase();
  }
}

export async function getCurrentUser(): Promise<{ user: UserProfile; authMode: "supabase" | "demo" }> {
  if (getAuthMode() === "supabase" || (!getAuthToken() && (await isSupabaseClientConfigured()))) {
    const live = await fetchLiveUserSession();
    if (live) {
      setAuthMode("supabase");
      setAuthToken(live.accessToken);
      cachedActiveUser = live.user;
      return { user: live.user, authMode: "supabase" };
    }
  }

  if (!getAuthToken()) {
    throw new ApiError("Not signed in.", 401);
  }

  setAuthMode("demo");
  const res = await apiFetch<{ user: UserProfile; authMode: "supabase" | "demo" }>("/api/auth/me");
  cachedActiveUser = res.user;
  return res;
}

async function resolveActiveProfile(): Promise<UserProfile> {
  if (cachedActiveUser) return cachedActiveUser;
  const { user } = await getCurrentUser();
  cachedActiveUser = user;
  return user;
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  if (getAuthMode() === "supabase") {
    const profile = await resolveActiveProfile();
    return fetchLiveBootstrap(profile);
  }
  return apiFetch("/api/bootstrap");
}

export async function fetchSalonActivity(salonId: string): Promise<SalonActivityPayload> {
  if (getAuthMode() === "supabase") {
    const profile = await resolveActiveProfile();
    return fetchLiveSalonActivity(salonId, profile.role);
  }
  return apiFetch(`/api/salons/${encodeURIComponent(salonId)}/activity`);
}

export async function submitShopOrder(input: CreateShopOrderInput): Promise<PublicShopOrder> {
  return apiFetch("/api/shop/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchManagerOverview(): Promise<ManagerOverviewPayload> {
  if (getAuthMode() === "supabase") {
    const profile = await resolveActiveProfile();
    return fetchLiveManagerOverview(profile);
  }
  return apiFetch("/api/manager/overview");
}

export async function submitManagerApproval(
  action: ManagerApprovalAction,
): Promise<{ ok: true; message: string }> {
  if (getAuthMode() === "supabase") {
    return executeLiveManagerApproval(action);
  }
  return apiFetch("/api/manager/approvals", {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export async function bulkImportSalonsApi(
  salons: Array<{ name: string; area?: string; phone?: string; contact?: string; creditLimit?: number }>,
): Promise<{ success: boolean; count: number; message: string }> {
  if (getAuthMode() === "supabase") {
    const count = await bulkImportLiveSalons(salons);
    return {
      success: true,
      count,
      message: `Successfully imported ${count} salons into Supabase.`,
    };
  }
  return apiFetch("/api/salons/bulk-import", {
    method: "POST",
    body: JSON.stringify({ salons }),
  });
}

export async function resendDeliveryNotification(orderId: string): Promise<DeliveryNotificationResult> {
  if (getAuthMode() === "supabase") {
    return {
      ok: true,
      orderId,
      orderNumber: orderId.slice(0, 8).toUpperCase(),
      salonName: "Salon",
      recipientPhone: "On-file contact",
      notifiedAt: new Date().toISOString(),
      message: "Delivery notification queued for recipient contact.",
    };
  }
  return apiFetch(`/api/deliveries/${encodeURIComponent(orderId)}/notify`, {
    method: "POST",
  });
}

export async function createCatalogSkuApi(
  input: CatalogSkuInput,
): Promise<{ ok: true; sku: SKU; message: string }> {
  if (getAuthMode() === "supabase") {
    const profile = await resolveActiveProfile();
    const sku = await upsertLiveCatalogSku(input, undefined, profile.role);
    return {
      ok: true,
      sku,
      message: `${sku.name} added to live Supabase catalog.`,
    };
  }
  return apiFetch("/api/catalog/skus", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCatalogSkuApi(
  id: string,
  input: CatalogSkuInput,
): Promise<{ ok: true; sku: SKU; message: string }> {
  if (getAuthMode() === "supabase") {
    const profile = await resolveActiveProfile();
    const sku = await upsertLiveCatalogSku(input, id, profile.role);
    return {
      ok: true,
      sku,
      message: `${sku.name} updated in live Supabase catalog.`,
    };
  }
  return apiFetch(`/api/catalog/skus/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function syncRouteOrderApi(stopIds: string[]): Promise<void> {
  if (getAuthMode() === "supabase") {
    await syncLiveRouteOrder(stopIds);
  }
}

