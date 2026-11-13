import type {
  BootstrapPayload,
  CreateShopOrderInput,
  ManagerApprovalAction,
  ManagerOverviewPayload,
  PublicShopOrder,
  SalonActivityPayload,
  UserProfile,
  UserRole,
} from "../server/types";

const TOKEN_STORAGE_KEY = "kiran.auth.token";

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

export async function getAuthConfig(): Promise<{ authConfigured: boolean; supabaseConfigured: boolean }> {
  return apiFetch("/api/auth/config");
}

export async function getGoogleOAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const origin = typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : "";
  return apiFetch(`/api/auth/google-url?origin=${origin}`);
}

export async function signInDemo(role: UserRole): Promise<{ token: string; user: UserProfile }> {
  return apiFetch("/api/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export async function getCurrentUser(): Promise<{ user: UserProfile; authMode: "supabase" | "demo" }> {
  return apiFetch("/api/auth/me");
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  return apiFetch("/api/bootstrap");
}

export async function fetchSalonActivity(salonId: string): Promise<SalonActivityPayload> {
  return apiFetch(`/api/salons/${encodeURIComponent(salonId)}/activity`);
}

export async function submitShopOrder(input: CreateShopOrderInput): Promise<PublicShopOrder> {
  return apiFetch("/api/shop/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchManagerOverview(): Promise<ManagerOverviewPayload> {
  return apiFetch("/api/manager/overview");
}

export async function submitManagerApproval(
  action: ManagerApprovalAction,
): Promise<{ ok: true; message: string }> {
  return apiFetch("/api/manager/approvals", {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export async function bulkImportSalonsApi(
  salons: Array<{ name: string; area?: string; phone?: string; contact?: string; creditLimit?: number }>,
): Promise<{ success: boolean; count: number; message: string }> {
  return apiFetch("/api/salons/bulk-import", {
    method: "POST",
    body: JSON.stringify({ salons }),
  });
}
