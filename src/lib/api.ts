import type { CatalogSkuInput } from "./catalog";
import type { SKU } from "./data";
import { isSupabaseClientConfigured, resolveSupabaseConfig, signOutSupabase } from "./supabase";
import {
  addOfficeInvestment,
  applySalonSignup,
  approveOfficeDelivery,
  assignSalonRep,
  bulkImportLiveSalons,
  cancelSalonRequest,
  confirmRepStockIssue,
  createOfficeInvitation,
  createOfficeInvestor,
  createOfficialOrderFromForecast,
  decideInvestorProfit,
  decideOfficeApproval,
  decideOfficeDevice,
  decideOfficeSignup,
  editSalonRequest,
  executeLiveManagerApproval,
  fetchInvoiceDocument,
  fetchInvestorInvestments,
  fetchInvestorStatement,
  fetchLiveBootstrap,
  fetchLiveCashLedgerEntries,
  fetchLiveManagerOverview,
  fetchLiveSalonActivity,
  fetchLiveUserSession,
  fetchLowStockAlerts,
  fetchOfficeCommission,
  fetchOfficeCommissionReps,
  fetchOfficeDeliverySignature,
  fetchOfficeDevices,
  fetchOfficeInvitations,
  fetchOfficeInvestors,
  fetchOfficeInvoices,
  fetchOfficePendingApprovals,
  fetchOfficePendingDeliveries,
  fetchOfficePendingSignups,
  fetchOfficePendingStock,
  fetchOfficeSignatureImage,
  fetchProductGroups,
  fetchRepBagStock,
  fetchRepCommission,
  fetchRepPendingIssues,
  fetchSalonCatalogue,
  fetchSalonInvoiceDocument,
  fetchSalonLoginStatus,
  fetchSalonMe,
  fetchSalonMyAccount,
  fetchSalonMyInvoices,
  fetchSalonMyOrders,
  fetchSalonMyRequests,
  fetchStaffUsers,
  fetchStockBalances,
  fetchStockLocations,
  ownerAdjustStock,
  proposeOfficeStockIssue,
  recordInvestorPayout,
  recordOfficeCommissionPayment,
  rejectOfficeDelivery,
  resolveOfficePendingStock,
  reverseInvestorEntry,
  reverseOfficeCommissionPayment,
  revokeOfficeInvitation,
  setOfficeCommissionRate,
  setOfficeMemberStatus,
  setOfficeReorderPoint,
  setOfficeSalonPrice,
  submitSalonRequest,
  syncLiveRouteOrder,
  upsertLiveCatalogSku,
} from "./supabase-kiran";
import type {
  BootstrapPayload,
  CashLedgerEntry,
  DeliveryNotificationResult,
  ManagerApprovalAction,
  ManagerOverviewPayload,
  SalonActivityPayload,
  UserProfile,
} from "../server/types";

const TOKEN_STORAGE_KEY = "kiran.auth.token";
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

async function infraFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
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
  return infraFetch("/api/auth/config");
}

export async function fetchMapsConfig(): Promise<{ apiKey: string }> {
  return infraFetch("/api/maps/config");
}

export async function getGoogleOAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const origin = typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : "";
  return infraFetch(`/api/auth/google-url?origin=${origin}`);
}

export async function signOutEverywhere(): Promise<void> {
  setAuthToken(null);
  cachedActiveUser = null;
  await signOutSupabase();
}

export async function getCurrentUser(): Promise<{ user: UserProfile; authMode: "supabase" }> {
  if (!(await isSupabaseClientConfigured())) {
    throw new ApiError("Supabase authentication is not configured.", 503, "SUPABASE_NOT_CONFIGURED");
  }
  const live = await fetchLiveUserSession();
  if (!live) {
    throw new ApiError("Not signed in.", 401);
  }
  setAuthToken(live.accessToken);
  cachedActiveUser = live.user;
  return { user: live.user, authMode: "supabase" };
}

async function resolveActiveProfile(): Promise<UserProfile> {
  if (cachedActiveUser) return cachedActiveUser;
  const { user } = await getCurrentUser();
  cachedActiveUser = user;
  return user;
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  const profile = await resolveActiveProfile();
  return fetchLiveBootstrap(profile);
}

export async function fetchSalonActivity(salonId: string): Promise<SalonActivityPayload> {
  const profile = await resolveActiveProfile();
  return fetchLiveSalonActivity(salonId, profile.role);
}

export async function fetchManagerOverview(): Promise<ManagerOverviewPayload> {
  const profile = await resolveActiveProfile();
  return fetchLiveManagerOverview(profile);
}

export async function fetchCashLedgerEntries(): Promise<CashLedgerEntry[]> {
  return fetchLiveCashLedgerEntries();
}

export async function submitManagerApproval(
  action: ManagerApprovalAction,
): Promise<{ ok: true; message: string }> {
  return executeLiveManagerApproval(action);
}

export async function bulkImportSalonsApi(
  salons: Array<{ name: string; area?: string; phone?: string; contact?: string; creditLimit?: number }>,
): Promise<{ success: boolean; count: number; message: string }> {
  const count = await bulkImportLiveSalons(salons);
  return {
    success: true,
    count,
    message: `Successfully imported ${count} salons into Supabase.`,
  };
}

export async function resendDeliveryNotification(_orderId: string): Promise<DeliveryNotificationResult> {
  throw new ApiError(
    "Automated WhatsApp/SMS delivery notification provider is not configured in Kiran Company Supabase backend.",
    501,
    "NOT_IMPLEMENTED",
  );
}

export async function createCatalogSkuApi(
  input: CatalogSkuInput,
): Promise<{ ok: true; sku: SKU; message: string }> {
  const profile = await resolveActiveProfile();
  const sku = await upsertLiveCatalogSku(input, undefined, profile.role);
  return {
    ok: true,
    sku,
    message: `${sku.name} added to live Supabase catalog.`,
  };
}

export async function updateCatalogSkuApi(
  id: string,
  input: CatalogSkuInput,
): Promise<{ ok: true; sku: SKU; message: string }> {
  const profile = await resolveActiveProfile();
  const sku = await upsertLiveCatalogSku(input, id, profile.role);
  return {
    ok: true,
    sku,
    message: `${sku.name} updated in live Supabase catalog.`,
  };
}

export async function syncRouteOrderApi(stopIds: string[]): Promise<void> {
  await syncLiveRouteOrder(stopIds);
}

export {
  addOfficeInvestment,
  applySalonSignup,
  approveOfficeDelivery,
  assignSalonRep,
  cancelSalonRequest,
  confirmRepStockIssue,
  createOfficeInvitation,
  createOfficeInvestor,
  createOfficialOrderFromForecast,
  decideInvestorProfit,
  decideOfficeApproval,
  decideOfficeDevice,
  decideOfficeSignup,
  editSalonRequest,
  fetchInvoiceDocument,
  fetchInvestorInvestments,
  fetchInvestorStatement,
  fetchLowStockAlerts,
  fetchOfficeCommission,
  fetchOfficeCommissionReps,
  fetchOfficeDeliverySignature,
  fetchOfficeDevices,
  fetchOfficeInvitations,
  fetchOfficeInvestors,
  fetchOfficeInvoices,
  fetchOfficePendingApprovals,
  fetchOfficePendingDeliveries,
  fetchOfficePendingSignups,
  fetchOfficePendingStock,
  fetchOfficeSignatureImage,
  fetchProductGroups,
  fetchRepBagStock,
  fetchRepCommission,
  fetchRepPendingIssues,
  fetchSalonCatalogue,
  fetchSalonInvoiceDocument,
  fetchSalonLoginStatus,
  fetchSalonMe,
  fetchSalonMyAccount,
  fetchSalonMyInvoices,
  fetchSalonMyOrders,
  fetchSalonMyRequests,
  fetchStaffUsers,
  fetchStockBalances,
  fetchStockLocations,
  ownerAdjustStock,
  proposeOfficeStockIssue,
  recordInvestorPayout,
  recordOfficeCommissionPayment,
  rejectOfficeDelivery,
  resolveOfficePendingStock,
  reverseInvestorEntry,
  reverseOfficeCommissionPayment,
  revokeOfficeInvitation,
  setOfficeCommissionRate,
  setOfficeMemberStatus,
  setOfficeReorderPoint,
  setOfficeSalonPrice,
  submitSalonRequest,
};
