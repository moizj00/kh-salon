import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCatalogSkuInput, type CatalogSkuInput } from "./catalog";
import type { DeliveryOrderItem, RouteStop, SKU } from "./data";
import type { OutboxFn } from "./outbox/types";
import {
  deviceId,
  ensureDeviceRegistered,
  getSupabaseClient,
  getSupabaseMfaStatus,
  karachiTodayIso,
} from "./supabase";
import type {
  BootstrapPayload,
  CashLedgerEntry,
  CommissionStatement,
  DeliveryOrderFull,
  DeliverySignatureStatus,
  InvestorInvestmentRow,
  InvestorStatementEntry,
  InvestorSummaryRow,
  LostDemandRecord,
  LowStockAlertRow,
  ManagerApprovalAction,
  ManagerOverviewPayload,
  OfficeApprovalRequestRow,
  OfficeCommissionRepSummary,
  OfficeDeviceRow,
  OfficeInvitationRow,
  OfficePendingDelivery,
  OrderCardRecord,
  PaymentRecord,
  PendingReturnStockRow,
  ProductGroupRow,
  PublicShopOrder,
  RepBagItem,
  RepMonthlyStats,
  RepPendingStockIssue,
  RepShift,
  SalonAccountSummary,
  SalonActivityPayload,
  SalonAreaOption,
  SalonCatalogueItem,
  SalonInvoiceRow,
  SalonLoginStatus,
  SalonPortalOrder,
  SalonPortalProfile,
  SalonPortalRequest,
  SalonSignupRequestRow,
  SalonType,
  SalonWithApproval,
  StockBalanceRow,
  StockLocationRow,
  UserProfile,
  UserRole,
  VisitRecord,
} from "../server/types";

export class SupabaseRpcError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ensureUuid(candidate?: string | null): string {
  if (typeof candidate === "string" && UUID_REGEX.test(candidate.trim())) {
    return candidate.trim().toLowerCase();
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export function pkrToPaisa(pkr: number): number {
  return Math.max(0, Math.round(Number(pkr || 0) * 100));
}

export function paisaToPkr(paisa: number | string | null | undefined): number {
  const num = Number(paisa ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num / 100);
}

export interface LiveSessionInfo {
  user_id?: string;
  full_name?: string;
  role?: UserRole;
  status?: "active" | "suspended" | "offboarded";
  device_status?: "pending" | "approved" | "revoked" | null;
}

export function mapLiveSessionToUserProfile(
  session: LiveSessionInfo | null,
  authUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  territoryLabel = "Karachi Territory",
  aalLevel: "aal1" | "aal2" | null = null,
): UserProfile {
  const role: UserRole =
    session?.role === "owner" || session?.role === "manager" || session?.role === "rep"
      ? session.role
      : "rep";

  const fullName =
    session?.full_name ||
    (typeof authUser.user_metadata?.full_name === "string" ? authUser.user_metadata.full_name : "") ||
    (typeof authUser.user_metadata?.name === "string" ? authUser.user_metadata.name : "") ||
    (authUser.email ? authUser.email.split("@")[0] : "Kiran User");

  const mfaRequired = (role === "owner" || role === "manager") && aalLevel === "aal1";

  return {
    id: session?.user_id || authUser.id,
    email: (authUser.email || "").toLowerCase(),
    fullName,
    role,
    territory: territoryLabel,
    monthlyVisitTarget: 50,
    deviceStatus: session?.device_status ?? null,
    accountStatus: session?.status ?? "active",
    aalLevel,
    mfaRequired,
  };
}

export interface MappedRpcCall {
  rpcName: string;
  rpcArgs: Record<string, unknown>;
}

/**
 * Translates UI / Outbox actions into exact Postgres `app.*` RPC signatures
 * matching the attached Supabase SQL migrations (no rep bag counts or samples).
 */
export function mapOutboxFnToLiveRpc(
  fn: OutboxFn,
  args: Record<string, unknown>,
  defaults?: {
    defaultSalonId?: string;
    defaultAreaId?: string;
    defaultBagId?: string;
    defaultLat?: number;
    defaultLng?: number;
  },
): MappedRpcCall {
  const clientId = ensureUuid(
    typeof args.p_client_id === "string"
      ? args.p_client_id
      : typeof args.p_id === "string"
        ? args.p_id
        : typeof args.id === "string"
          ? args.id
          : null,
  );
  const nowIso = String(args.p_at_client ?? args.p_recorded_at_client ?? new Date().toISOString());

  switch (fn) {
    case "rep_check_in": {
      if (args.p_fail || args.fail) {
        return {
          rpcName: "log_visit",
          rpcArgs: {
            p_client_id: clientId,
            p_salon_id: ensureUuid(defaults?.defaultSalonId),
            p_outcome: "invalid_outcome_test",
            p_lat: 24.8607,
            p_lng: 67.0011,
          },
        };
      }
      return {
        rpcName: "rep_check_in",
        rpcArgs: {
          p_counted: Array.isArray(args.p_counted) ? args.p_counted : [],
          p_lat: typeof args.p_lat === "number" ? args.p_lat : null,
          p_lng: typeof args.p_lng === "number" ? args.p_lng : null,
          p_at_client: nowIso,
        },
      };
    }

    case "record_count":
      return {
        rpcName: "record_count",
        rpcArgs: {
          p_client_id: clientId,
          p_location_id: ensureUuid(
            typeof args.p_location_id === "string" ? args.p_location_id : defaults?.defaultBagId ?? "",
          ),
          p_kind: String(args.p_kind ?? "spot_check"),
          p_counted: Array.isArray(args.p_counted) ? args.p_counted : [],
          p_counted_at_client: nowIso,
        },
      };

    case "rep_check_out":
      return {
        rpcName: "rep_check_out",
        rpcArgs: {
          p_at_client: nowIso,
        },
      };

    case "log_visit": {
      const rawOutcome = String(args.p_outcome ?? "intro");
      const validOutcome =
        rawOutcome === "contacted" || !rawOutcome ? "intro" : rawOutcome;
      return {
        rpcName: "log_visit",
        rpcArgs: {
          p_client_id: clientId,
          p_salon_id: ensureUuid(String(args.p_salon_id ?? defaults?.defaultSalonId ?? "")),
          p_outcome: validOutcome,
          p_lat: typeof args.p_lat === "number" ? args.p_lat : (defaults?.defaultLat ?? 24.8607),
          p_lng: typeof args.p_lng === "number" ? args.p_lng : (defaults?.defaultLng ?? 67.0011),
          p_arrived_at_client: nowIso,
          p_notes: typeof args.p_notes === "string" && args.p_notes.trim() ? args.p_notes.trim() : null,
          p_mock_location: false,
        },
      };
    }

    case "add_salon_note":
      return {
        rpcName: "add_salon_note",
        rpcArgs: {
          p_client_id: clientId,
          p_salon_id: ensureUuid(String(args.p_salon_id ?? defaults?.defaultSalonId ?? "")),
          p_body: String(args.p_body ?? args.p_notes ?? "").trim() || "Follow-up noted.",
          p_created_at_client: nowIso,
        },
      };

    case "create_salon": {
      const salonUuid = ensureUuid(typeof args.p_id === "string" ? args.p_id : clientId);
      const areaId = String(args.p_area_id ?? defaults?.defaultAreaId ?? "").trim();
      const rawType = String(args.p_type ?? "unisex");
      const validType = rawType === "salon" || !rawType ? "unisex" : rawType;
      return {
        rpcName: "create_salon",
        rpcArgs: {
          p_id: salonUuid,
          p_name: String(args.p_name ?? "").trim(),
          p_type: validType,
          p_area_id: areaId ? ensureUuid(areaId) : null,
          p_source: String(args.p_source ?? "manual"),
          p_address: typeof args.p_address === "string" ? args.p_address : String(args.p_area ?? ""),
          p_lat: typeof args.p_lat === "number" ? args.p_lat : (defaults?.defaultLat ?? null),
          p_lng: typeof args.p_lng === "number" ? args.p_lng : (defaults?.defaultLng ?? null),
          p_chairs: typeof args.p_chairs === "number" ? args.p_chairs : null,
          p_contact_name: typeof args.p_contact === "string" ? args.p_contact : null,
          p_contact_phone: typeof args.p_phone === "string" ? args.p_phone : null,
          p_note: null,
          p_created_at_client: nowIso,
        },
      };
    }

    case "rep_create_card": {
      const skuId = String(args.p_sku_id ?? "");
      const qty = Math.max(1, Math.round(Number(args.p_qty ?? 1)));
      const notes = typeof args.p_notes === "string" ? args.p_notes.trim() : "";
      const skuLabel = typeof args.p_sku_name === "string" ? args.p_sku_name : "Catalog SKU";
      const body = notes || `${skuLabel} × ${qty}`;
      const lines = UUID_REGEX.test(skuId) ? [{ sku_id: skuId, qty }] : null;
      return {
        rpcName: "rep_create_card",
        rpcArgs: {
          p_client_id: clientId,
          p_salon_id: ensureUuid(String(args.p_salon_id ?? defaults?.defaultSalonId ?? "")),
          p_body: body,
          p_visit_id: typeof args.p_visit_id === "string" && UUID_REGEX.test(args.p_visit_id) ? args.p_visit_id : null,
          p_lines: lines,
        },
      };
    }

    case "rep_record_payment": {
      throw new SupabaseRpcError(
        "In-app and field-rep payments are disabled. Bank-to-Bank and Cash-to-Cash settlements must be recorded and marked paid by an Office Manager or Owner.",
        403,
        "42501",
      );
    }

    case "record_demand": {
      const qty = Math.max(1, Math.round(Number(args.p_qty ?? 1)));
      const reason = String(args.p_reason ?? "out_of_stock");
      const skuId =
        reason === "not_in_catalogue"
          ? null
          : typeof args.p_sku_id === "string" && UUID_REGEX.test(args.p_sku_id)
            ? args.p_sku_id
            : null;
      const groupId =
        reason === "not_in_catalogue" &&
        typeof args.p_product_group_id === "string" &&
        UUID_REGEX.test(args.p_product_group_id)
          ? args.p_product_group_id
          : null;
      return {
        rpcName: "record_demand",
        rpcArgs: {
          p_client_id: clientId,
          p_sku_id: skuId,
          p_product_group_id: groupId,
          p_qty: qty,
          p_reason: reason,
          p_salon_id: typeof args.p_salon_id === "string" && UUID_REGEX.test(args.p_salon_id) ? args.p_salon_id : null,
          p_captured_at_client: nowIso,
        },
      };
    }

    case "rep_submit_delivery":
      return {
        rpcName: "rep_submit_delivery",
        rpcArgs: {
          p_client_id: clientId,
          p_order_id: ensureUuid(String(args.p_order_id ?? "")),
          p_received_by_name: String(args.p_received_by_name ?? "Salon Reception"),
          p_lat: typeof args.p_lat === "number" ? args.p_lat : (defaults?.defaultLat ?? 24.8607),
          p_lng: typeof args.p_lng === "number" ? args.p_lng : (defaults?.defaultLng ?? 67.0011),
          p_lines: Array.isArray(args.p_lines) ? args.p_lines : null,
          p_mock_location: false,
          p_submitted_at_client: nowIso,
        },
      };

    case "rep_attach_signature": {
      const rawSig = String(args.p_signature_data ?? args.p_png_base64 ?? "");
      const pngBase64 = rawSig.includes("base64,") ? rawSig.split("base64,")[1] || "" : rawSig;
      return {
        rpcName: "rep_attach_signature",
        rpcArgs: {
          p_client_id: clientId,
          p_submission_id: ensureUuid(String(args.p_submission_id ?? args.p_delivery_id ?? "")),
          p_outcome: String(args.p_outcome ?? "signed"),
          p_name: String(args.p_name ?? "Salon Owner"),
          p_designation: String(args.p_designation ?? "Manager"),
          p_png_base64: pngBase64 || null,
          p_note: typeof args.p_note === "string" ? args.p_note : null,
        },
      };
    }
  }
}

function findImageKeyFallback(code: string, name: string, brand: string): string | undefined {
  const hay = `${code} ${name} ${brand}`.toLowerCase();
  if (hay.includes("mocheqi")) {
    if (hay.includes("mask") || hay.includes("conditioner")) return "mocheqi-mask";
    if (hay.includes("serum") || hay.includes("oil")) return "mocheqi-serum";
    return "mocheqi-shampoo";
  }
  if (hay.includes("lumex")) {
    if (hay.includes("keratin") || hay.includes("botox") || hay.includes("smoothing")) return "lumex-keratin";
    if (hay.includes("purple") || hay.includes("toning") || hay.includes("ash")) return "lumex-toner";
    return "lumex-shampoo";
  }
  if (hay.includes("argan")) return "argan-serum";
  if (hay.includes("keratin")) return "keratin-500";
  if (hay.includes("shampoo")) return "clarifying-shampoo";
  return undefined;
}

function normalizeSkuCategory(raw: string): SKU["category"] {
  const lower = raw.toLowerCase();
  if (lower.includes("shampoo") || lower.includes("clean")) return "Shampoo";
  if (lower.includes("color") || lower.includes("dye") || lower.includes("tone")) return "Color";
  if (lower.includes("styl") || lower.includes("serum") || lower.includes("oil") || lower.includes("spray")) {
    return "Styling";
  }
  return "Treatment";
}

export function mapCatalogueRowsToSkus(
  catalogueRows: Array<Record<string, unknown>>,
  availabilityRows: Array<Record<string, unknown>> = [],
): SKU[] {
  const availMap = new Map<string, number>();
  for (const row of availabilityRows) {
    if (row.sku_id) {
      availMap.set(String(row.sku_id), Math.max(0, Number(row.available ?? 0)));
    }
  }

  const mapped: SKU[] = [];
  for (const prod of catalogueRows) {
    const productId = String(prod.product_id ?? prod.id ?? "");
    const groupId = prod.product_group_id ? String(prod.product_group_id) : undefined;
    const brand = String(prod.brand_label ?? "Lumex");
    const productName = String(prod.name ?? "Product");
    const rawCategory = String(prod.group_name ?? "Treatment");
    const category = normalizeSkuCategory(rawCategory);
    const description = typeof prod.description === "string" ? prod.description : undefined;
    const imagePath = typeof prod.image_path === "string" ? prod.image_path : undefined;
    const skuList = Array.isArray(prod.skus) ? (prod.skus as Array<Record<string, unknown>>) : [];

    for (const k of skuList) {
      if (k.active === false) continue;
      const skuId = String(k.id ?? "");
      const code = String(k.code ?? skuId);
      const variant = String(k.variant ?? "").trim();
      const sizeVal = k.size_value !== null && k.size_value !== undefined ? String(k.size_value) : "";
      const rawUnit = String(k.unit ?? "pack");
      const volumeSize = sizeVal ? `${sizeVal}${rawUnit}` : variant || rawUnit;
      const displayName = variant && !productName.toLowerCase().includes(variant.toLowerCase())
        ? `${productName} ${variant}`
        : productName;

      mapped.push({
        id: skuId,
        sku_code: code,
        name: displayName,
        category,
        price: paisaToPkr(k.list_price_paisa as number | string | null | undefined),
        bag_qty: availMap.get(skuId) ?? 0,
        unit: rawUnit === "ml" || rawUnit === "l" || rawUnit === "g" ? "Bottle" : "Pack",
        brand,
        product_type: rawCategory,
        volume_size: volumeSize,
        recommended_use: description || `Professional ${brand} salon formula (${volumeSize}).`,
        image_key: imagePath || findImageKeyFallback(code, displayName, brand),
        product_id: productId,
        product_group_id: groupId,
      });
    }
  }

  return mapped;
}

export function mapSalonRowsToSalons(
  rows: Array<Record<string, unknown>>,
  receivablesBySalonId?: Map<string, number>,
): SalonWithApproval[] {
  return rows.map((r) => {
    const id = String(r.salon_id ?? r.id ?? "");
    const rawApproval = String(r.approval_status ?? r.verification_status ?? "approved");
    const approval_status: SalonWithApproval["approval_status"] =
      rawApproval === "pending" || rawApproval === "pending_review"
        ? "pending_review"
        : rawApproval === "rejected"
          ? "rejected"
          : "approved";

    const rawStage = String(r.stage ?? "prospect");
    const stage: SalonWithApproval["stage"] =
      rawStage === "vip" || rawStage === "regular" || rawStage === "trial" || rawStage === "prospect"
        ? rawStage
        : "prospect";

    // Resolve normalized salon_contact child relation when present
    const contacts = Array.isArray(r.salon_contact)
      ? (r.salon_contact as Array<Record<string, unknown>>)
      : [];
    const activeContacts = contacts.filter((c) => c.active !== false);
    const primaryContact = activeContacts.find((c) => c.is_primary) ?? activeContacts[0] ?? null;

    // Resolve normalized salon_credit relation (1:1 object or single-element array)
    const creditRel = Array.isArray(r.salon_credit)
      ? (r.salon_credit[0] as Record<string, unknown> | undefined)
      : (r.salon_credit as Record<string, unknown> | null | undefined);

    const areaRel = Array.isArray(r.area)
      ? (r.area[0] as Record<string, unknown> | undefined)
      : (r.area as Record<string, unknown> | null | undefined);

    const areaName = String(areaRel?.name ?? r.area_name ?? r.area ?? "Karachi");
    const outstandingPaisa = receivablesBySalonId?.has(id)
      ? receivablesBySalonId.get(id)!
      : Number(r.outstanding_paisa ?? 0);
    const creditLimitPaisa = creditRel?.credit_limit_paisa ?? r.credit_limit_paisa;

    return {
      id,
      name: String(r.name ?? "Salon"),
      area: areaName,
      address: String(r.address ?? areaName),
      phone: String(primaryContact?.phone ?? r.phone_masked ?? r.phone ?? "On file"),
      contact_person: String(primaryContact?.name ?? r.contact_person ?? "Salon Owner"),
      stage,
      approval_status,
      outstanding_balance: paisaToPkr(outstandingPaisa),
      credit_limit: paisaToPkr(creditLimitPaisa as number | string | undefined) || 50000,
      last_visited_at: r.last_visited_at ? String(r.last_visited_at) : null,
      notes_count: Number(r.notes_count ?? 0),
      open_cards_count: Number(r.open_cards_count ?? 0),
      lat: r.lat !== null && r.lat !== undefined ? Number(r.lat) : undefined,
      lng: r.lng !== null && r.lng !== undefined ? Number(r.lng) : undefined,
    };
  });
}

export function mapRouteRowsToStops(
  rows: Array<Record<string, unknown>>,
  salons: SalonWithApproval[],
): RouteStop[] {
  const salonMap = new Map(salons.map((s) => [s.id, s]));
  return rows.map((r, index) => {
    const salonId = String(r.salon_id ?? "");
    const salon = salonMap.get(salonId);
    const reasonRaw = String(r.reason ?? "due_cycle");
    const due_reason: RouteStop["due_reason"] =
      reasonRaw === "delivery" || reasonRaw === "order_delivery"
        ? "order_delivery"
        : reasonRaw === "payment" || reasonRaw === "payment_due"
          ? "payment_due"
          : "weekly_cycle";
    return {
      id: String(r.stop_id ?? r.id ?? `stop-${index + 1}`),
      stop_number: Number(r.sequence ?? index + 1),
      salon_id: salonId,
      salon_name: String(r.salon_name ?? salon?.name ?? "Salon"),
      area: String(r.area_name ?? salon?.area ?? "Karachi"),
      due_reason,
      balance: salon?.outstanding_balance ?? 0,
      status: r.visited ? "visited" : "pending",
    };
  });
}

export interface OrderHydrationContext {
  linesByOrderId?: Map<string, DeliveryOrderItem[]>;
  deliveriesByOrderId?: Map<string, { status: string; delivered_at: string | null }>;
  signaturesByOrderId?: Map<string, string | null>;
}

export function mapOrderRowsToDeliveryOrders(
  rows: Array<Record<string, unknown>>,
  salonNames: Map<string, string>,
  hydration?: OrderHydrationContext,
): DeliveryOrderFull[] {
  return rows.map((o) => {
    const id = String(o.order_id ?? o.id ?? "");
    const salonId = String(o.salon_id ?? "");
    const deliveryInfo = hydration?.deliveriesByOrderId?.get(id);
    const rawStatus = String(deliveryInfo?.status ?? o.status ?? "confirmed");
    const status: DeliveryOrderFull["status"] =
      rawStatus === "delivered" || rawStatus === "completed" ? "delivered" : "pending_delivery";
    const totalPkr = paisaToPkr(o.total_paisa as number | string | null | undefined);
    const shortRef = id.slice(0, 6).toUpperCase();
    const hydratedLines = hydration?.linesByOrderId?.get(id);
    const items =
      hydratedLines && hydratedLines.length > 0
        ? hydratedLines
        : Array.isArray(o.items)
          ? (o.items as DeliveryOrderFull["items"])
          : [{ sku_name: `${String(o.plan ?? "CASH")} Order`, qty: 1, price: totalPkr }];

    return {
      id,
      order_number: String(o.order_number ?? `ORD-${shortRef}`),
      salon_id: salonId,
      salon_name: String(o.salon_name ?? salonNames.get(salonId) ?? "Salon"),
      items,
      total_amount: totalPkr,
      status,
      delivered_at: deliveryInfo?.delivered_at ?? (o.delivered_at ? String(o.delivered_at) : null),
      created_at: o.created_at ? String(o.created_at) : null,
      notes: o.cancel_reason ? String(o.cancel_reason) : null,
      signature_data: hydration?.signaturesByOrderId?.get(id) ?? null,
    };
  });
}

export function mapRepDayRowsToShifts(
  rows: Array<Record<string, unknown>>,
  repNames?: Map<string, string>,
): RepShift[] {
  return rows.map((d) => {
    const repId = String(d.rep_id ?? "");
    const profileRel = Array.isArray(d.user_profile)
      ? (d.user_profile[0] as { full_name?: string } | undefined)
      : (d.user_profile as { full_name?: string } | null | undefined);
    return {
      id: String(d.id ?? ""),
      repId,
      repName: profileRel?.full_name || repNames?.get(repId) || "Field Rep",
      status: d.status === "open" ? "open" : "closed",
      openingBagCount: 0,
      closingBagCount: null,
      expectedBagCount: null,
      varianceUnits: 0,
      countRecordId: null,
      openedAt: String(d.check_in_at ?? new Date().toISOString()),
      closedAt: d.check_out_at ? String(d.check_out_at) : null,
      approvalStatus: "approved",
    };
  });
}

export function mapPaymentRowsToRecords(
  rows: Array<Record<string, unknown>>,
  salonNames: Map<string, string>,
  receiptsByPaymentId?: Map<string, string>,
  reversalsByPaymentId?: Map<string, { reason: string; reversed_at: string }>,
  actorNames?: Map<string, string>,
  currentUser?: UserProfile,
): PaymentRecord[] {
  return rows.map((p) => {
    const id = String(p.payment_id ?? p.id ?? "");
    const salonId = String(p.salon_id ?? "");
    const recordedBy = String(p.recorded_by ?? "");
    const receiptNo =
      typeof p.receipt_number === "string"
        ? p.receipt_number
        : receiptsByPaymentId?.get(id) ?? null;
    const reversal = reversalsByPaymentId?.get(id);
    const reversed = Boolean(p.reversed_at || reversal);
    const recordedRoleRaw = String(p.recorded_by_role ?? "manager");
    const recordedByRole: UserRole =
      recordedRoleRaw === "owner" || recordedRoleRaw === "manager" || recordedRoleRaw === "rep"
        ? recordedRoleRaw
        : "manager";
    const recordedByName =
      typeof p.recorded_by_name === "string"
        ? p.recorded_by_name
        : actorNames?.get(recordedBy) ?? null;
    const mayReverse =
      typeof p.may_reverse === "boolean"
        ? p.may_reverse
        : !reversed &&
          Boolean(currentUser) &&
          (currentUser?.role === "owner" ||
            (currentUser?.role === "manager" && recordedBy !== currentUser.id));

    return {
      id,
      repId: recordedBy,
      salonId,
      salonName: salonNames.get(salonId) ?? "Salon",
      amount: paisaToPkr(p.amount_paisa as number | string | undefined),
      method: String(p.method ?? "cash"),
      capturedAt: String(p.recorded_at ?? new Date().toISOString()),
      receiptNumber: receiptNo,
      bankName: typeof p.bank_name === "string" ? p.bank_name : null,
      bankReference: typeof p.bank_reference === "string" ? p.bank_reference : null,
      recordedByName,
      recordedByRole,
      reversed,
      reversalReason:
        typeof p.reversal_reason === "string"
          ? p.reversal_reason
          : reversal?.reason ?? null,
      reversedAt:
        typeof p.reversed_at === "string"
          ? p.reversed_at
          : reversal?.reversed_at ?? null,
      mayReverse,
    };
  });
}

export function mapCashLedgerRowsToEntries(
  rows: Array<Record<string, unknown>>,
  salonNames: Map<string, string>,
  actorNames?: Map<string, string>,
): CashLedgerEntry[] {
  return rows.map((r, idx) => {
    const id = String(r.id ?? `cle-${idx}`);
    const entryNumber = String(r.entry_number ?? `CLE-2026-${String(idx + 1).padStart(4, "0")}`);
    const entryTypeRaw = String(r.entry_type ?? "settlement");
    const entryType: CashLedgerEntry["entryType"] =
      entryTypeRaw === "bank_transfer" ||
      entryTypeRaw === "cash_collection" ||
      entryTypeRaw === "reversal" ||
      entryTypeRaw === "expense"
        ? (entryTypeRaw as CashLedgerEntry["entryType"])
        : "settlement";

    const refTypeRaw = String(r.reference_type ?? "payment");
    const referenceType: CashLedgerEntry["referenceType"] =
      refTypeRaw === "receipt" || refTypeRaw === "reversal" || refTypeRaw === "handover"
        ? (refTypeRaw as CashLedgerEntry["referenceType"])
        : "payment";

    const referenceId = String(r.reference_id ?? "");
    const salonId = typeof r.salon_id === "string" ? r.salon_id : undefined;
    const salonName = salonId
      ? salonNames.get(salonId)
      : typeof r.salon_name === "string"
        ? r.salon_name
        : undefined;
    const actorId = typeof r.actor_id === "string" ? r.actor_id : undefined;
    const actorName = actorId
      ? actorNames?.get(actorId)
      : typeof r.actor_name === "string"
        ? r.actor_name
        : undefined;

    const statusRaw = String(r.status ?? "approved");
    const status: CashLedgerEntry["status"] =
      statusRaw === "pending" || statusRaw === "verified" || statusRaw === "reversed"
        ? (statusRaw as CashLedgerEntry["status"])
        : "approved";

    return {
      id,
      entryNumber,
      entryType,
      amountPkr: paisaToPkr(r.amount_paisa as number | string | undefined),
      balanceAfterPkr: paisaToPkr(r.balance_after_paisa as number | string | undefined),
      referenceType,
      referenceId,
      salonId,
      salonName,
      actorId,
      actorName,
      status,
      bankName: typeof r.bank_name === "string" ? r.bank_name : null,
      bankReference: typeof r.bank_reference === "string" ? r.bank_reference : null,
      receiptNumber: typeof r.receipt_number === "string" ? r.receipt_number : null,
      notes: typeof r.notes === "string" ? r.notes : null,
      createdAt: String(r.created_at ?? new Date().toISOString()),
    };
  });
}

function throwIfRpcError(
  error: { message?: string; code?: string; status?: number } | null,
  fallbackMessage: string,
): void {
  if (!error) return;
  throw new SupabaseRpcError(
    error.message?.trim() || fallbackMessage,
    typeof error.status === "number" ? error.status : 400,
    typeof error.code === "string" ? error.code : "P0001",
  );
}

async function requireClient(): Promise<SupabaseClient> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new SupabaseRpcError("Supabase client is not configured.", 503, "PGRST000");
  }
  return client;
}

export async function fetchLiveUserSession(): Promise<{
  user: UserProfile;
  accessToken: string;
} | null> {
  const client = await getSupabaseClient();
  if (!client) return null;

  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return null;

  const { data: authData, error: authErr } = await client.auth.getUser();
  if (authErr || !authData.user) return null;

  const currentDevice = deviceId();
  let { data: liveSession, error: sessErr } = await client.schema("app").rpc("my_session");
  if (sessErr) {
    throwIfRpcError(sessErr, "Could not load Supabase session.");
  }

  let parsed = (liveSession ?? null) as LiveSessionInfo | null;
  if (parsed && (parsed.device_status === null || parsed.device_status === "revoked")) {
    await ensureDeviceRegistered(parsed.device_status, currentDevice);
    const refreshed = await client.schema("app").rpc("my_session");
    if (!refreshed.error && refreshed.data) {
      parsed = refreshed.data as LiveSessionInfo;
    }
  }

  let territoryLabel = "Karachi Territory";
  try {
    const areasRes = await client.schema("app").rpc("my_areas");
    const firstArea = Array.isArray(areasRes.data) ? (areasRes.data[0] as { territory_name?: string }) : null;
    if (firstArea?.territory_name) {
      territoryLabel = firstArea.territory_name;
    }
  } catch {
    // Ignore optional territory lookup failure
  }

  const mfa = await getSupabaseMfaStatus();

  return {
    user: mapLiveSessionToUserProfile(parsed, authData.user, territoryLabel, mfa.currentLevel),
    accessToken,
  };
}

async function hydrateOrderContext(
  client: SupabaseClient,
  orderIds: string[],
): Promise<OrderHydrationContext> {
  if (orderIds.length === 0) return {};
  const [linesRes, delivRes, sigRes] = await Promise.all([
    client
      .from("sales_order_line")
      .select("order_id, line_no, qty, unit_price_paisa, sku(code, variant, product(name))")
      .in("order_id", orderIds)
      .order("line_no"),
    client
      .from("delivery")
      .select("order_id, status, delivered_at")
      .in("order_id", orderIds)
      .order("delivered_at", { ascending: false }),
    client
      .from("delivery_signature")
      .select("order_id, outcome, signatory_name")
      .in("order_id", orderIds),
  ]);

  const linesByOrderId = new Map<string, DeliveryOrderItem[]>();
  for (const row of (linesRes.data ?? []) as Array<Record<string, unknown>>) {
    const orderId = String(row.order_id ?? "");
    if (!orderId) continue;
    const skuRel = row.sku as { code?: string; variant?: string; product?: { name?: string } } | null;
    const prodName = skuRel?.product?.name || skuRel?.code || "SKU";
    const variant = skuRel?.variant ? ` ${skuRel.variant}` : "";
    const list = linesByOrderId.get(orderId) ?? [];
    list.push({
      sku_name: `${prodName}${variant}`.trim(),
      qty: Number(row.qty ?? 1),
      price: paisaToPkr(row.unit_price_paisa as number | undefined),
    });
    linesByOrderId.set(orderId, list);
  }

  const deliveriesByOrderId = new Map<string, { status: string; delivered_at: string | null }>();
  for (const row of (delivRes.data ?? []) as Array<Record<string, unknown>>) {
    const orderId = String(row.order_id ?? "");
    if (!orderId || deliveriesByOrderId.has(orderId)) continue;
    deliveriesByOrderId.set(orderId, {
      status: String(row.status ?? "delivered"),
      delivered_at: row.delivered_at ? String(row.delivered_at) : null,
    });
  }

  const signaturesByOrderId = new Map<string, string | null>();
  for (const row of (sigRes.data ?? []) as Array<Record<string, unknown>>) {
    const orderId = String(row.order_id ?? "");
    if (!orderId) continue;
    if (String(row.outcome ?? "") === "signed") {
      signaturesByOrderId.set(orderId, `signed:${String(row.signatory_name ?? "Customer")}`);
    }
  }

  return { linesByOrderId, deliveriesByOrderId, signaturesByOrderId };
}

export async function dispatchLiveOutboxRpc(
  fn: OutboxFn,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const client = await requireClient();
  let defaultAreaId: string | undefined;
  let defaultSalonId: string | undefined;
  let defaultBagId: string | undefined;

  if (fn === "create_salon" && !args.p_area_id) {
    const areasRes = await client.schema("app").rpc("my_areas");
    const areas = Array.isArray(areasRes.data) ? (areasRes.data as Array<{ area_id?: string }>) : [];
    defaultAreaId = areas[0]?.area_id;
  }
  if (fn === "record_count" && !args.p_location_id) {
    const bagRes = await client.schema("app").rpc("my_bag_id");
    if (typeof bagRes.data === "string" && UUID_REGEX.test(bagRes.data)) {
      defaultBagId = bagRes.data;
    }
  }
  if (args.p_fail || args.fail) {
    const salonsRes = await client.schema("app").rpc("my_salons", { p_limit: 1 });
    const s = Array.isArray(salonsRes.data) ? (salonsRes.data[0] as { id?: string }) : null;
    defaultSalonId = s?.id;
  }

  const mapped = mapOutboxFnToLiveRpc(fn, args, {
    defaultAreaId,
    defaultSalonId,
    defaultBagId,
  });

  const { data, error, status } = await client.schema("app").rpc(mapped.rpcName, mapped.rpcArgs);
  if (error) {
    throw new SupabaseRpcError(
      error.message || "Database refused request.",
      typeof status === "number" ? status : 400,
      error.code || "P0001",
    );
  }
  return (typeof data === "object" && data !== null ? data : { result: data }) as Record<string, unknown>;
}

export async function fetchLiveBootstrap(user: UserProfile): Promise<BootstrapPayload> {
  const client = await requireClient();

  if (user.role === "rep") {
    const [salonsRes, areasRes, routeRes, dayRes, ordersRes, availRes, skusRes, monthRes] =
      await Promise.all([
        client.schema("app").rpc("my_salons", { p_limit: 100 }),
        client.schema("app").rpc("my_areas"),
        client.schema("app").rpc("my_route"),
        client.schema("app").rpc("my_day"),
        client.schema("app").rpc("my_territory_orders"),
        client.schema("app").rpc("warehouse_availability"),
        client
          .from("product")
          .select("id, product_group_id, brand_label, name, description, image_path, active, product_group(name), sku(id, code, variant, unit, size_value, list_price_paisa, active)")
          .eq("active", true),
        client.schema("app").rpc("my_month_orders", { p_month: new Date().toISOString().slice(0, 10) }),
      ]);

    const salons = mapSalonRowsToSalons((salonsRes.data ?? []) as Array<Record<string, unknown>>);
    const salonNames = new Map(salons.map((s) => [s.id, s.name]));
    const areas: SalonAreaOption[] = ((areasRes.data ?? []) as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.area_id ?? ""),
      name: String(a.area_name ?? ""),
      territoryId: a.territory_id ? String(a.territory_id) : undefined,
      territoryName: a.territory_name ? String(a.territory_name) : undefined,
    }));
    const route = mapRouteRowsToStops((routeRes.data ?? []) as Array<Record<string, unknown>>, salons);
    const rawOrders = (ordersRes.data ?? []) as Array<Record<string, unknown>>;
    const orderIds = rawOrders.map((o) => String(o.order_id ?? o.id ?? "")).filter(Boolean);
    const orderHydration = await hydrateOrderContext(client, orderIds);
    const orders = mapOrderRowsToDeliveryOrders(rawOrders, salonNames, orderHydration);

    const catalogueRows = ((skusRes.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
      product_id: p.id,
      product_group_id: p.product_group_id,
      group_name: (p.product_group as { name?: string } | null)?.name ?? "Haircare",
      brand_label: p.brand_label,
      name: p.name,
      description: p.description,
      image_path: p.image_path,
      active: p.active,
      skus: Array.isArray(p.sku) ? p.sku : [],
    }));
    const liveSkus = mapCatalogueRowsToSkus(
      catalogueRows,
      (availRes.data ?? []) as Array<Record<string, unknown>>,
    );

    const dayRow = Array.isArray(dayRes.data)
      ? ((dayRes.data[0] as Record<string, unknown> | undefined) ?? null)
      : null;
    const activeShift: RepShift | null =
      dayRow && dayRow.status === "open"
        ? {
            id: String(dayRow.id),
            repId: user.id,
            repName: user.fullName,
            status: "open",
            openingBagCount: 0,
            closingBagCount: null,
            expectedBagCount: null,
            varianceUnits: 0,
            countRecordId: null,
            openedAt: String(dayRow.check_in_at ?? new Date().toISOString()),
            closedAt: null,
            approvalStatus: "approved",
          }
        : null;

    const mRow = Array.isArray(monthRes.data)
      ? ((monthRes.data[0] as Record<string, unknown> | undefined) ?? null)
      : null;

    const stats: RepMonthlyStats = {
      visitsCompleted: Number(dayRow?.visits ?? 0),
      visitsTarget: user.monthlyVisitTarget,
      cashCollectedPkr: paisaToPkr((mRow?.delivered_value_paisa as number) ?? 0),
      ordersCount: Number(mRow?.orders_count ?? orders.length),
      monthLabel:
        new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date()) +
        " Target",
    };

    return {
      profile: user,
      salons,
      route,
      skus: liveSkus,
      orders,
      activeShift,
      currentBagCount: 0,
      stats,
      areas,
      authMode: "supabase",
    };
  }

  // Owner / Office Manager bootstrap
  const [overview, areasRes] = await Promise.all([
    fetchLiveManagerOverview(user),
    client.from("area").select("id, name, territory(id, name)").eq("active", true),
  ]);

  const areas: SalonAreaOption[] = ((areasRes.data ?? []) as Array<Record<string, unknown>>).map((a) => ({
    id: String(a.id ?? ""),
    name: String(a.name ?? ""),
    territoryId: (a.territory as { id?: string } | null)?.id,
    territoryName: (a.territory as { name?: string } | null)?.name,
  }));

  return {
    profile: user,
    salons: overview.salons,
    route: [],
    skus: overview.skus,
    orders: overview.deliveryOrders,
    activeShift: null,
    currentBagCount: 0,
    stats: overview.stats,
    areas,
    authMode: "supabase",
  };
}

export async function fetchLiveSalonActivity(
  salonId: string,
  role: UserRole = "rep",
): Promise<SalonActivityPayload> {
  const client = await requireClient();
  const isOffice = role === "manager" || role === "owner";

  const [salonRes, visitsRes, notesRes, ordersRes, cardsRes, paymentsRes] = await Promise.all([
    role === "rep"
      ? client.schema("app").rpc("my_salon", { p_id: salonId })
      : client
          .from("salon")
          .select("*, area(name), salon_contact(name, phone, is_primary, active), salon_credit(credit_limit_paisa, plan_eligibility, blocked)")
          .eq("id", salonId)
          .maybeSingle(),
    client.schema("app").rpc("salon_visits", { p_salon_id: salonId }),
    client.schema("app").rpc("salon_notes", { p_salon_id: salonId }),
    role === "rep"
      ? client.schema("app").rpc("my_territory_orders")
      : client.schema("app").rpc("office_orders"),
    client
      .from("order_intake_card")
      .select("id, rep_id, body, created_at, order_intake_card_line(sku_id, qty, unit_price_paisa, sku(code, variant, product(name))), order_intake_card_close(outcome)")
      .eq("salon_id", salonId)
      .order("created_at", { ascending: false })
      .limit(15),
    isOffice
      ? client.schema("app").rpc("office_salon_payments", { p_salon_id: salonId })
      : client
          .from("payment")
          .select("id, recorded_by, recorded_by_role, salon_id, method, amount_paisa, bank_name, bank_reference, recorded_at")
          .eq("salon_id", salonId)
          .order("recorded_at", { ascending: false })
          .limit(20),
  ]);

  const rawSalon = Array.isArray(salonRes.data)
    ? (salonRes.data[0] as Record<string, unknown> | undefined)
    : (salonRes.data as Record<string, unknown> | null);

  if (!rawSalon) {
    throw new SupabaseRpcError(`Salon '${salonId}' not found.`, 404, "P0002");
  }

  let receivablesMap: Map<string, number> | undefined;
  if (isOffice) {
    const ageingRes = await client.schema("app").rpc("office_receivables_ageing", { p_group: "salon" });
    if (!ageingRes.error && Array.isArray(ageingRes.data)) {
      receivablesMap = new Map(
        (ageingRes.data as Array<{ group_id?: string; total_paisa?: number }>)
          .filter((a) => a.group_id)
          .map((a) => [String(a.group_id), Number(a.total_paisa ?? 0)]),
      );
    }
  }

  const mappedSalon = mapSalonRowsToSalons([rawSalon], receivablesMap)[0]!;
  const salonNames = new Map([[salonId, mappedSalon.name]]);

  const visits: VisitRecord[] = ((visitsRes.data ?? []) as Array<Record<string, unknown>>).map((v) => ({
    id: String(v.id ?? ""),
    repId: String(v.rep_id ?? ""),
    salonId,
    notes: String(v.notes ?? v.outcome ?? ""),
    lat: null,
    lng: null,
    capturedAt: String(v.arrived_at ?? new Date().toISOString()),
  }));

  const notes = (notesRes.data ?? []) as Array<Record<string, unknown>>;
  if (notes.length > 0 && visits.length === 0) {
    for (const n of notes) {
      visits.push({
        id: String(n.id ?? ""),
        repId: String(n.author_id ?? ""),
        salonId,
        notes: String(n.body ?? ""),
        lat: null,
        lng: null,
        capturedAt: String(n.created_at ?? new Date().toISOString()),
      });
    }
  }

  const rawPaymentRows = (paymentsRes.data ?? []) as Array<Record<string, unknown>>;
  let receiptsMap: Map<string, string> | undefined;
  let reversalsMap: Map<string, { reason: string; reversed_at: string }> | undefined;
  if (!isOffice && rawPaymentRows.length > 0) {
    const payIds = rawPaymentRows.map((p) => String(p.id ?? "")).filter(Boolean);
    const [rcpRes, revRes] = await Promise.all([
      client.from("receipt").select("payment_id, number").in("payment_id", payIds),
      client.from("payment_reversal").select("payment_id, reason, reversed_at").in("payment_id", payIds),
    ]);
    receiptsMap = new Map(
      ((rcpRes.data ?? []) as Array<{ payment_id?: string; number?: string }>)
        .filter((r) => r.payment_id && r.number)
        .map((r) => [String(r.payment_id), String(r.number)]),
    );
    reversalsMap = new Map(
      ((revRes.data ?? []) as Array<{ payment_id?: string; reason?: string; reversed_at?: string }>)
        .filter((r) => r.payment_id)
        .map((r) => [
          String(r.payment_id),
          { reason: String(r.reason ?? ""), reversed_at: String(r.reversed_at ?? "") },
        ]),
    );
  }

  const payments = mapPaymentRowsToRecords(
    rawPaymentRows.map((p) => ({ ...p, salon_id: p.salon_id ?? salonId })),
    salonNames,
    receiptsMap,
    reversalsMap,
  );

  const orderCards: OrderCardRecord[] = ((cardsRes.data ?? []) as Array<Record<string, unknown>>).map((c) => {
    const lines = Array.isArray(c.order_intake_card_line)
      ? (c.order_intake_card_line as Array<Record<string, unknown>>)
      : [];
    const first = lines[0];
    const skuRel = first?.sku as { code?: string; variant?: string; product?: { name?: string } } | null | undefined;
    const skuName = skuRel?.product?.name
      ? `${skuRel.product.name} ${skuRel.variant ?? ""}`.trim()
      : String(c.body ?? "Order Request");
    const qty = Number(first?.qty ?? 1);
    const totalPaisa = lines.reduce(
      (sum, l) => sum + Number(l.qty ?? 1) * Number(l.unit_price_paisa ?? 0),
      0,
    );
    const closeRel = Array.isArray(c.order_intake_card_close)
      ? (c.order_intake_card_close[0] as { outcome?: string } | undefined)
      : (c.order_intake_card_close as { outcome?: string } | null | undefined);
    const status: OrderCardRecord["status"] =
      closeRel?.outcome === "converted"
        ? "approved"
        : closeRel?.outcome === "dismissed"
          ? "rejected"
          : "pending_approval";

    return {
      id: String(c.id ?? ""),
      repId: String(c.rep_id ?? ""),
      salonId,
      salonName: mappedSalon.name,
      skuId: String(first?.sku_id ?? ""),
      skuName,
      qty,
      totalAmount: paisaToPkr(totalPaisa),
      notes: c.body ? String(c.body) : null,
      status,
      capturedAt: String(c.created_at ?? new Date().toISOString()),
    };
  });

  const matchingRawOrders = ((ordersRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((o) => String(o.salon_id ?? "") === salonId)
    .slice(0, 5);
  const matchingIds = matchingRawOrders.map((o) => String(o.order_id ?? o.id ?? "")).filter(Boolean);
  const orderHydration = await hydrateOrderContext(client, matchingIds);
  const recentOrders = mapOrderRowsToDeliveryOrders(matchingRawOrders, salonNames, orderHydration);

  return {
    salon: mappedSalon,
    visits,
    payments,
    orderCards,
    recentOrders,
  };
}

export async function fetchLiveManagerOverview(
  user: UserProfile,
): Promise<ManagerOverviewPayload> {
  const client = await requireClient();
  const [
    salonsRes,
    pendingSalonsRes,
    openCardsRes,
    ordersRes,
    catalogueRes,
    availRes,
    repDaysRes,
    paymentsRes,
    demandRes,
    ageingRes,
  ] = await Promise.all([
    client
      .from("salon")
      .select("id, name, stage, approval_status, verification_status, address, lat, lng, area(name), salon_contact(name, phone, is_primary, active), salon_credit(credit_limit_paisa, plan_eligibility, blocked)")
      .order("name"),
    client.schema("app").rpc("office_pending_salons"),
    client.schema("app").rpc("office_open_cards"),
    client.schema("app").rpc("office_orders"),
    client.schema("app").rpc("office_catalogue"),
    client.schema("app").rpc("warehouse_availability"),
    client
      .from("rep_day")
      .select("id, rep_id, day, status, check_in_at, check_out_at, user_profile!rep_day_rep_id_fkey(full_name)")
      .order("check_in_at", { ascending: false })
      .limit(20),
    client
      .from("payment")
      .select("id, recorded_by, recorded_by_role, salon_id, method, amount_paisa, bank_name, bank_reference, recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(30),
    client
      .from("demand_signal")
      .select("id, captured_by, qty, reason, created_at, sku(code, variant, product(name))")
      .order("created_at", { ascending: false })
      .limit(25),
    client.schema("app").rpc("office_receivables_ageing", { p_group: "salon" }),
  ]);

  throwIfRpcError(catalogueRes.error, "Could not load catalog (verify Office AAL2 TOTP MFA).");
  throwIfRpcError(ordersRes.error, "Could not load office orders.");

  const receivablesMap = new Map<string, number>();
  if (!ageingRes.error && Array.isArray(ageingRes.data)) {
    for (const row of ageingRes.data as Array<{ group_id?: string; total_paisa?: number }>) {
      if (row.group_id) {
        receivablesMap.set(String(row.group_id), Number(row.total_paisa ?? 0));
      }
    }
  }

  const salons = mapSalonRowsToSalons(
    (salonsRes.data ?? []) as Array<Record<string, unknown>>,
    receivablesMap,
  );
  const salonNames = new Map(salons.map((s) => [s.id, s.name]));

  const pendingSalons = mapSalonRowsToSalons(
    (pendingSalonsRes.data ?? []) as Array<Record<string, unknown>>,
    receivablesMap,
  ).map((s) => ({ ...s, approval_status: "pending_review" as const }));

  const pendingOrderCards: OrderCardRecord[] = (
    (openCardsRes.data ?? []) as Array<Record<string, unknown>>
  ).map((c) => {
    const lines = Array.isArray(c.lines) ? (c.lines as Array<Record<string, unknown>>) : [];
    const first = lines[0] ?? {};
    return {
      id: String(c.card_id ?? ""),
      repId: String(c.rep_id ?? ""),
      salonId: String(c.salon_id ?? ""),
      salonName: String(c.salon_name ?? salonNames.get(String(c.salon_id ?? "")) ?? "Salon"),
      skuId: String(first.sku_id ?? ""),
      skuName: String(first.product_name ?? first.code ?? c.body ?? "Order Request"),
      qty: Number(first.qty ?? 1),
      totalAmount: paisaToPkr(c.estimate_paisa as number | undefined),
      notes: c.body ? String(c.body) : null,
      status: "pending_approval",
      capturedAt: String(c.created_at ?? new Date().toISOString()),
    };
  });

  const shifts = mapRepDayRowsToShifts((repDaysRes.data ?? []) as Array<Record<string, unknown>>);

  const rawPayments = (paymentsRes.data ?? []) as Array<Record<string, unknown>>;
  const paymentIds = rawPayments.map((p) => String(p.id ?? "")).filter(Boolean);
  const actorIds = Array.from(new Set(rawPayments.map((p) => String(p.recorded_by ?? "")).filter(Boolean)));

  let receiptsMap = new Map<string, string>();
  let reversalsMap = new Map<string, { reason: string; reversed_at: string }>();
  let actorNamesMap = new Map<string, string>();

  if (paymentIds.length > 0) {
    const [rcpRes, revRes, profRes] = await Promise.all([
      client.from("receipt").select("payment_id, number").in("payment_id", paymentIds),
      client.from("payment_reversal").select("payment_id, reason, reversed_at").in("payment_id", paymentIds),
      actorIds.length > 0
        ? client.from("user_profile").select("id, full_name").in("id", actorIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    ]);

    receiptsMap = new Map(
      ((rcpRes.data ?? []) as Array<{ payment_id?: string; number?: string }>)
        .filter((r) => r.payment_id && r.number)
        .map((r) => [String(r.payment_id), String(r.number)]),
    );
    reversalsMap = new Map(
      ((revRes.data ?? []) as Array<{ payment_id?: string; reason?: string; reversed_at?: string }>)
        .filter((r) => r.payment_id)
        .map((r) => [
          String(r.payment_id),
          { reason: String(r.reason ?? ""), reversed_at: String(r.reversed_at ?? "") },
        ]),
    );
    actorNamesMap = new Map(
      ((profRes.data ?? []) as Array<{ id?: string; full_name?: string }>)
        .filter((u) => u.id && u.full_name)
        .map((u) => [String(u.id), String(u.full_name)]),
    );
  }

  const recentPayments = mapPaymentRowsToRecords(
    rawPayments,
    salonNames,
    receiptsMap,
    reversalsMap,
    actorNamesMap,
    user,
  );

  const rawOrders = (ordersRes.data ?? []) as Array<Record<string, unknown>>;
  const orderIds = rawOrders.map((o) => String(o.order_id ?? o.id ?? "")).filter(Boolean);
  const orderHydration = await hydrateOrderContext(client, orderIds);
  const deliveryOrders = mapOrderRowsToDeliveryOrders(rawOrders, salonNames, orderHydration);

  const lostDemand: LostDemandRecord[] = (
    (demandRes.data ?? []) as Array<Record<string, unknown>>
  ).map((d) => {
    const sku = d.sku as { code?: string; variant?: string; product?: { name?: string } } | null;
    const label = sku?.product?.name ? `${sku.product.name} ${sku.variant ?? ""}`.trim() : String(d.reason ?? "Unstocked item");
    return {
      id: String(d.id ?? ""),
      repId: String(d.captured_by ?? ""),
      skuName: label,
      qty: Number(d.qty ?? 1),
      capturedAt: String(d.created_at ?? new Date().toISOString()),
    };
  });

  const skus = mapCatalogueRowsToSkus(
    (catalogueRes.data ?? []) as Array<Record<string, unknown>>,
    (availRes.data ?? []) as Array<Record<string, unknown>>,
  );

  const cashCollectedPkr = recentPayments
    .filter((p) => !p.reversed)
    .reduce((sum, p) => sum + p.amount, 0);

  let runningPkr = 0;
  const sortedPaymentsAsc = [...recentPayments].sort(
    (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  );
  const ledgerEntriesMap = new Map<string, number>();
  for (const p of sortedPaymentsAsc) {
    if (!p.reversed) {
      runningPkr += p.amount;
    }
    ledgerEntriesMap.set(p.id, runningPkr);
  }

  const cashLedgerEntries: CashLedgerEntry[] = recentPayments.map((p, idx) => ({
    id: p.id,
    entryNumber: `CLE-2026-${String(recentPayments.length - idx).padStart(4, "0")}`,
    entryType: p.method.includes("bank") ? ("bank_transfer" as const) : ("settlement" as const),
    amountPkr: p.amount,
    balanceAfterPkr: ledgerEntriesMap.get(p.id) ?? p.amount,
    referenceType: "payment" as const,
    referenceId: p.id,
    salonId: p.salonId,
    salonName: p.salonName,
    actorId: p.repId,
    actorName: p.recordedByName || "Office Manager",
    actorRole: p.recordedByRole,
    status: p.reversed ? ("reversed" as const) : ("approved" as const),
    bankName: p.bankName,
    bankReference: p.bankReference,
    receiptNumber: p.receiptNumber,
    notes: p.reversalReason ? `Reversed: ${p.reversalReason}` : "Off-app settlement approved",
    createdAt: p.capturedAt,
  }));

  return {
    pendingSalons,
    pendingOrderCards,
    shifts,
    recentPayments,
    cashLedgerEntries,
    salons,
    shopOrders: [] as PublicShopOrder[],
    deliveryOrders,
    lostDemand,
    skus,
    stats: {
      visitsCompleted: shifts.length,
      visitsTarget: user.monthlyVisitTarget,
      cashCollectedPkr,
      ordersCount: deliveryOrders.length + pendingOrderCards.length,
      monthLabel:
        new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date()) +
        " Target",
    },
  };
}

export async function executeLiveManagerApproval(
  action: ManagerApprovalAction,
): Promise<{ ok: true; message: string }> {
  const client = await requireClient();

  switch (action.action) {
    case "approve_salon": {
      const salonId = ensureUuid(action.id);
      const { error } = await client.schema("app").rpc("office_decide_salon", {
        p_client_id: ensureUuid(),
        p_salon_id: salonId,
        p_approve: true,
        p_reason: "Approved via Office Manager dashboard.",
      });
      throwIfRpcError(error, "Could not approve salon.");
      if (action.stage && (action.stage === "trial" || action.stage === "regular" || action.stage === "vip")) {
        const { error: stageErr } = await client.schema("app").rpc("office_override_stage", {
          p_salon_id: salonId,
          p_to: action.stage,
          p_reason: `Stage set to ${action.stage} on approval.`,
        });
        throwIfRpcError(stageErr, "Salon approved, but stage override failed.");
      }
      return { ok: true, message: "Salon approved and active." };
    }

    case "reject_salon": {
      const { error } = await client.schema("app").rpc("office_decide_salon", {
        p_client_id: ensureUuid(),
        p_salon_id: ensureUuid(action.id),
        p_approve: false,
        p_reason: "Declined via Office Manager dashboard.",
      });
      throwIfRpcError(error, "Could not decline salon.");
      return { ok: true, message: "Salon prospect declined." };
    }

    case "approve_order_card": {
      const { data: cards } = await client.schema("app").rpc("office_open_cards");
      const card = Array.isArray(cards)
        ? (cards as Array<Record<string, unknown>>).find((c) => String(c.card_id) === action.id)
        : null;
      if (!card) {
        throw new SupabaseRpcError("Order intake card not found.", 404, "P0002");
      }
      const lines = Array.isArray(card.lines)
        ? (card.lines as Array<{ sku_id: string; qty: number }>).map((l) => ({
            sku_id: l.sku_id,
            qty: Number(l.qty || 1),
          }))
        : [];
      const { error } = await client.schema("app").rpc("office_create_order", {
        p_client_id: ensureUuid(),
        p_salon_id: ensureUuid(String(card.salon_id)),
        p_plan: "CASH",
        p_lines: lines,
        p_assigned_rep_id: card.rep_id ? ensureUuid(String(card.rep_id)) : null,
        p_intake_card_id: ensureUuid(action.id),
        p_card_version: typeof card.version === "number" ? card.version : null,
      });
      throwIfRpcError(error, "Could not convert intake card to sales order.");
      return { ok: true, message: "Order intake card converted to confirmed order." };
    }

    case "reject_order_card": {
      const { error } = await client.schema("app").rpc("office_dismiss_card", {
        p_card_id: ensureUuid(action.id),
        p_reason: "Declined via Office Manager dashboard.",
      });
      throwIfRpcError(error, "Could not dismiss order intake card.");
      return { ok: true, message: "Order intake card dismissed." };
    }

    case "bulk_process_order_cards": {
      for (const id of action.ids) {
        await executeLiveManagerApproval({
          action: action.decision === "approve" ? "approve_order_card" : "reject_order_card",
          id,
        });
      }
      return {
        ok: true,
        message:
          action.decision === "approve"
            ? `${action.ids.length} order intake cards approved.`
            : `${action.ids.length} order intake cards dismissed.`,
      };
    }

    case "mark_delivery_delivered": {
      const orderId = ensureUuid(action.id);
      const { data: locs } = await client
        .from("stock_location")
        .select("id, kind")
        .eq("kind", "warehouse")
        .eq("active", true)
        .limit(1);
      const warehouseId = (locs?.[0] as { id?: string } | undefined)?.id;
      if (!warehouseId) {
        throw new SupabaseRpcError("No active warehouse stock location configured.", 400, "P0002");
      }

      if (action.signature) {
        const { data: lines } = await client
          .from("sales_order_line")
          .select("sku_id, qty")
          .eq("order_id", orderId)
          .order("line_no");
        const orderLines = ((lines ?? []) as Array<{ sku_id: string; qty: number }>).map((l) => ({
          sku_id: l.sku_id,
          qty: Number(l.qty || 1),
        }));
        const rawSig = action.signature.pngBase64 || "";
        const pngBase64 = rawSig.includes("base64,") ? rawSig.split("base64,")[1] || "" : rawSig;
        const { error: sigErr } = await client.schema("app").rpc("office_attach_signature", {
          p_client_id: ensureUuid(),
          p_order_id: orderId,
          p_lines: orderLines,
          p_outcome: action.signature.outcome,
          p_name: action.signature.signatoryName.trim(),
          p_designation: action.signature.designation.trim(),
          p_png_base64: pngBase64 || null,
          p_note: action.signature.note?.trim() || null,
        });
        throwIfRpcError(sigErr, "Could not record delivery signature.");
      }

      const { error } = await client.schema("app").rpc("office_deliver", {
        p_client_id: ensureUuid(),
        p_order_id: orderId,
        p_warehouse_id: ensureUuid(warehouseId),
        p_received_by_name: action.signature?.signatoryName?.trim() || "Salon Reception",
      });
      throwIfRpcError(error, "Could not mark order delivered.");
      return { ok: true, message: "Order marked as delivered." };
    }

    case "mark_deliveries_delivered": {
      for (const id of action.ids) {
        await executeLiveManagerApproval({ action: "mark_delivery_delivered", id });
      }
      return { ok: true, message: `${action.ids.length} orders marked as delivered.` };
    }

    case "record_office_payment": {
      const amountPaisa = pkrToPaisa(action.amountPkr);
      if (amountPaisa <= 0) {
        throw new SupabaseRpcError("Payment amount must be greater than zero PKR.", 422, "22023");
      }
      if (action.method === "bank_transfer") {
        const bankName = (action.bankName ?? "").trim();
        const bankRef = (action.bankReference ?? "").trim();
        if (bankName.length < 2 || bankName.length > 60) {
          throw new SupabaseRpcError("Bank name must be 2 to 60 characters.", 422, "22023");
        }
        if (bankRef.length < 3 || bankRef.length > 60) {
          throw new SupabaseRpcError("Bank reference / IBFT ID must be 3 to 60 characters.", 422, "22023");
        }
        const { data, error } = await client.schema("app").rpc("office_record_payment", {
          p_client_id: ensureUuid(),
          p_salon_id: ensureUuid(action.salonId),
          p_amount_paisa: amountPaisa,
          p_bank_name: bankName,
          p_bank_reference: bankRef,
          p_lat: null,
          p_lng: null,
        });
        throwIfRpcError(error, "Could not record Bank-to-Bank payment.");
        const receiptNo = (data as { number?: string } | null)?.number ?? "";
        return {
          ok: true,
          message: `Bank-to-Bank payment PKR ${action.amountPkr.toLocaleString()} marked Paid${receiptNo ? ` (${receiptNo})` : ""}.`,
        };
      }

      const { data, error } = await client.schema("app").rpc("office_record_cash", {
        p_client_id: ensureUuid(),
        p_salon_id: ensureUuid(action.salonId),
        p_amount_paisa: amountPaisa,
        p_lat: null,
        p_lng: null,
      });
      throwIfRpcError(error, "Could not record Cash-to-Cash settlement.");
      const receiptNo = (data as { number?: string } | null)?.number ?? "";
      return {
        ok: true,
        message: `Cash-to-Cash settlement PKR ${action.amountPkr.toLocaleString()} marked Paid${receiptNo ? ` (${receiptNo})` : ""}.`,
      };
    }

    case "reverse_office_payment": {
      const reason = (action.reason ?? "").trim();
      if (reason.length < 5 || reason.length > 300) {
        throw new SupabaseRpcError("Reversal reason must be 5 to 300 characters.", 422, "22023");
      }
      const { error } = await client.schema("app").rpc("office_reverse_payment", {
        p_client_id: ensureUuid(),
        p_payment_id: ensureUuid(action.paymentId),
        p_reason: reason,
      });
      throwIfRpcError(error, "Could not reverse payment record.");
      return { ok: true, message: "Payment reversed and salon balance restored." };
    }
  }
}

export async function syncLiveRouteOrder(stopIds: string[]): Promise<void> {
  if (stopIds.length === 0 || !stopIds.every((id) => UUID_REGEX.test(id))) {
    return;
  }
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("rep_reorder_route", {
    p_day: karachiTodayIso(),
    p_stop_ids: stopIds.map((id) => ensureUuid(id)),
  });
  throwIfRpcError(error, "Could not persist route order.");
}

export async function upsertLiveCatalogSku(
  input: CatalogSkuInput,
  existingId?: string,
  userRole: UserRole = "manager",
): Promise<SKU> {
  const validated = validateCatalogSkuInput(input);
  if (validated.ok === false) {
    throw new SupabaseRpcError(validated.error, 400, "22023");
  }
  const clean = validated.value;
  const client = await requireClient();

  const { data: groups } = await client.from("product_group").select("id, name").eq("active", true);
  let groupId = (groups ?? []).find(
    (g) => String((g as { name?: string }).name ?? "").toLowerCase() === clean.category.toLowerCase(),
  )?.id as string | undefined;

  if (!groupId) {
    groupId = ensureUuid();
    const { error: grpErr } = await client.schema("app").rpc("office_upsert_product_group", {
      p_id: groupId,
      p_name: clean.category.slice(0, 60),
      p_default_cycle_days: 30,
      p_active: true,
    });
    throwIfRpcError(grpErr, "Could not create product group.");
  }

  let productId = ensureUuid();
  let skuId = existingId && UUID_REGEX.test(existingId) ? existingId : ensureUuid();

  if (existingId && UUID_REGEX.test(existingId)) {
    const { data: existingSku } = await client
      .from("sku")
      .select("id, product_id")
      .eq("id", existingId)
      .maybeSingle();
    if (existingSku?.product_id) {
      productId = String(existingSku.product_id);
      skuId = String(existingSku.id);
    }
  }

  const validImagePath =
    clean.image_key &&
    /^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/i.test(clean.image_key)
      ? clean.image_key
      : null;

  const { error: prodErr } = await client.schema("app").rpc("office_upsert_product", {
    p_id: productId,
    p_product_group_id: groupId,
    p_brand_label: clean.brand,
    p_name: clean.name,
    p_active: true,
    p_description: clean.recommended_use,
    p_image_path: validImagePath,
  });
  throwIfRpcError(prodErr, "Could not save catalog product.");

  const unitMap: Record<string, string> = {
    Bottle: "ml",
    Jar: "g",
    Pack: "pack",
    Tube: "ml",
    Box: "pack",
  };
  const dbUnit = unitMap[clean.unit] ?? "pack";
  const numericSizeMatch = clean.volume_size.match(/(\d+(?:\.\d+)?)/);
  const sizeValue = numericSizeMatch ? Number(numericSizeMatch[1]) : null;

  const { error: skuErr } = await client.schema("app").rpc("office_upsert_sku", {
    p_id: skuId,
    p_product_id: productId,
    p_code: clean.sku_code.toUpperCase(),
    p_variant: clean.volume_size || clean.product_type,
    p_unit: dbUnit,
    p_size_value: sizeValue && sizeValue > 0 ? sizeValue : null,
    p_units_per_carton: null,
    p_barcode: null,
    p_active: true,
  });
  throwIfRpcError(skuErr, "Could not save catalog SKU.");

  const pricePaisa = pkrToPaisa(clean.price);
  if (userRole === "owner") {
    const { error: priceErr } = await client.schema("app").rpc("owner_set_sku_price", {
      p_sku_id: skuId,
      p_list_price_paisa: pricePaisa,
      p_reason: "Updated from Kiran catalog",
    });
    throwIfRpcError(priceErr, "Could not set SKU price.");
  } else {
    const { error: priceErr } = await client.schema("app").rpc("office_set_sku_price", {
      p_client_id: ensureUuid(),
      p_sku_id: skuId,
      p_price_paisa: pricePaisa,
      p_reason: "Updated from Kiran catalog",
    });
    throwIfRpcError(priceErr, "Could not set SKU price.");
  }

  return {
    id: skuId,
    sku_code: clean.sku_code,
    name: clean.name,
    category: clean.category,
    price: clean.price,
    bag_qty: clean.bag_qty,
    unit: clean.unit,
    brand: clean.brand,
    product_type: clean.product_type,
    volume_size: clean.volume_size,
    recommended_use: clean.recommended_use,
    image_key: clean.image_key,
    product_id: productId,
    product_group_id: groupId,
  };
}

export async function bulkImportLiveSalons(
  salons: Array<{ name: string; area?: string; phone?: string; contact?: string; creditLimit?: number }>,
): Promise<number> {
  const client = await requireClient();
  const { data: areas } = await client.from("area").select("id, name").eq("active", true);
  const areaList = (areas ?? []) as Array<{ id: string; name: string }>;
  const defaultAreaId = areaList[0]?.id;
  if (!defaultAreaId) {
    throw new SupabaseRpcError("No active territory area exists in Supabase yet.", 400, "P0002");
  }

  let created = 0;
  for (const s of salons) {
    const name = s.name?.trim();
    if (!name) continue;
    const areaNeedle = (s.area ?? "").trim().toLowerCase();
    const matchedArea = areaList.find((a) => a.name.toLowerCase().includes(areaNeedle)) ?? areaList[0]!;
    const { error } = await client.schema("app").rpc("create_salon", {
      p_id: ensureUuid(),
      p_name: name,
      p_type: "salon",
      p_area_id: matchedArea.id,
      p_source: "manual",
      p_address: s.area?.trim() || matchedArea.name,
      p_contact_name: s.contact?.trim() || "Owner",
      p_contact_phone: s.phone?.trim() || null,
    });
    throwIfRpcError(error, `Could not import salon ${name}.`);
    created += 1;
  }
  return created;
}

export async function fetchLiveCashLedgerEntries(limit = 100): Promise<CashLedgerEntry[]> {
  const client = await requireClient();
  const { data, error } = await client
    .from("cash_ledger_entry")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data) || data.length === 0) {
    const { data: payRows } = await client
      .from("payment")
      .select("id, recorded_by, recorded_by_role, salon_id, method, amount_paisa, bank_name, bank_reference, recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(limit);

    if (Array.isArray(payRows) && payRows.length > 0) {
      const salonIds = Array.from(new Set(payRows.map((p) => String(p.salon_id ?? "")).filter(Boolean)));
      const payIds = payRows.map((p) => String(p.id ?? "")).filter(Boolean);
      const actorIds = Array.from(new Set(payRows.map((p) => String(p.recorded_by ?? "")).filter(Boolean)));

      const [salonRes, rcpRes, revRes, actorRes] = await Promise.all([
        salonIds.length > 0 ? client.from("salon").select("id, name").in("id", salonIds) : Promise.resolve({ data: [] }),
        payIds.length > 0 ? client.from("receipt").select("payment_id, number").in("payment_id", payIds) : Promise.resolve({ data: [] }),
        payIds.length > 0 ? client.from("payment_reversal").select("payment_id, reason, reversed_at").in("payment_id", payIds) : Promise.resolve({ data: [] }),
        actorIds.length > 0 ? client.from("user_profile").select("id, full_name").in("id", actorIds) : Promise.resolve({ data: [] }),
      ]);

      const salonNames = new Map((salonRes.data ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
      const receiptNumbers = new Map((rcpRes.data ?? []).map((r: { payment_id: string; number: string }) => [r.payment_id, r.number]));
      const reversals = new Map((revRes.data ?? []).map((rv: { payment_id: string; reason: string }) => [rv.payment_id, rv.reason]));
      const actorNames = new Map((actorRes.data ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]));

      let runningPaisa = 0;
      const sortedAsc = [...payRows].sort((a, b) => new Date(String(a.recorded_at)).getTime() - new Date(String(b.recorded_at)).getTime());
      const entries: CashLedgerEntry[] = [];

      for (let i = 0; i < sortedAsc.length; i++) {
        const p = sortedAsc[i];
        const isReversed = reversals.has(String(p.id));
        const amtPaisa = Number(p.amount_paisa ?? 0);
        runningPaisa += isReversed ? 0 : amtPaisa;
        const entryType = String(p.method).includes("bank") ? "bank_transfer" : "settlement";
        entries.push({
          id: String(p.id),
          entryNumber: `CLE-2026-${String(i + 1).padStart(4, "0")}`,
          entryType,
          amountPkr: paisaToPkr(amtPaisa),
          balanceAfterPkr: paisaToPkr(runningPaisa),
          referenceType: "payment",
          referenceId: String(p.id),
          salonId: String(p.salon_id ?? ""),
          salonName: salonNames.get(String(p.salon_id ?? "")) ?? "Salon Client",
          actorId: String(p.recorded_by ?? ""),
          actorName: actorNames.get(String(p.recorded_by ?? "")) ?? "Office Manager",
          status: isReversed ? "reversed" : "approved",
          bankName: typeof p.bank_name === "string" ? p.bank_name : null,
          bankReference: typeof p.bank_reference === "string" ? p.bank_reference : null,
          receiptNumber: receiptNumbers.get(String(p.id)) ?? null,
          notes: isReversed ? `Reversal: ${reversals.get(String(p.id))}` : `Settlement verified by Office Manager`,
          createdAt: String(p.recorded_at ?? new Date().toISOString()),
        });
      }
      return entries.reverse();
    }
    return [];
  }

  const salonIds = Array.from(new Set(data.map((d) => String(d.salon_id ?? "")).filter(Boolean)));
  const actorIds = Array.from(new Set(data.map((d) => String(d.actor_id ?? "")).filter(Boolean)));
  const [salonRes, actorRes] = await Promise.all([
    salonIds.length > 0 ? client.from("salon").select("id, name").in("id", salonIds) : Promise.resolve({ data: [] }),
    actorIds.length > 0 ? client.from("user_profile").select("id, full_name").in("id", actorIds) : Promise.resolve({ data: [] }),
  ]);
  const salonNames = new Map((salonRes.data ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
  const actorNames = new Map((actorRes.data ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]));

  return mapCashLedgerRowsToEntries(data, salonNames, actorNames);
}

// =============================================================================
// Salon Partner Portal (Email OTP proof + active salon_membership required)
// =============================================================================

export async function fetchSalonLoginStatus(): Promise<SalonLoginStatus | null> {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.schema("app").rpc("salon_login_status");
  if (error || !data) return null;
  const row = data as { membership_status?: string | null; name?: string | null };
  return {
    membershipStatus: (row.membership_status ?? null) as SalonLoginStatus["membershipStatus"],
    salonName: row.name ?? null,
  };
}

export async function applySalonSignup(input: {
  salonName: string;
  contactName: string;
  type: SalonType;
  address: string;
}): Promise<{ status: string }> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_apply", {
    p_client_id: ensureUuid(),
    p_salon_name: input.salonName.trim(),
    p_contact_name: input.contactName.trim(),
    p_type: input.type,
    p_address: input.address.trim(),
  });
  throwIfRpcError(error, "Could not submit salon portal application.");
  return (data ?? { status: "pending" }) as { status: string };
}

export async function fetchSalonMe(): Promise<SalonPortalProfile | null> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_me");
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    salonId: String(r.salon_id ?? ""),
    salonName: String(r.salon_name ?? "Salon Partner"),
    type: String(r.type ?? "unisex") as SalonType,
    stage: String(r.stage ?? "prospect") as SalonPortalProfile["stage"],
    address: r.address ? String(r.address) : null,
    areaName: String(r.area_name ?? "Karachi"),
    contactName: r.contact_name ? String(r.contact_name) : null,
    email: String(r.email ?? ""),
    creditLimitPaisa: Number(r.credit_limit_paisa ?? 0),
    planEligibility: String(r.plan_eligibility ?? "CASH"),
    blocked: Boolean(r.blocked),
  };
}

export async function fetchSalonCatalogue(): Promise<SalonCatalogueItem[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_catalogue");
  throwIfRpcError(error, "Could not load salon partner catalog.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    productId: String(r.product_id ?? ""),
    brandLabel: String(r.brand_label ?? ""),
    productName: String(r.product_name ?? ""),
    description: r.description ? String(r.description) : null,
    imagePath: r.image_path ? String(r.image_path) : null,
    groupName: String(r.group_name ?? ""),
    skuId: String(r.sku_id ?? ""),
    code: String(r.code ?? ""),
    variant: String(r.variant ?? ""),
    unit: String(r.unit ?? ""),
    sizeValue: r.size_value !== null && r.size_value !== undefined ? Number(r.size_value) : null,
    pricePaisa: Number(r.price_paisa ?? 0),
    ownPrice: Boolean(r.own_price),
  }));
}

export async function fetchSalonMyRequests(): Promise<SalonPortalRequest[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_my_requests");
  throwIfRpcError(error, "Could not load salon order requests.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    requestId: String(r.request_id ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    version: Number(r.version ?? 1),
    note: r.note ? String(r.note) : null,
    lines: Array.isArray(r.lines)
      ? (r.lines as Array<Record<string, unknown>>).map((l) => ({
          skuId: String(l.sku_id ?? ""),
          code: String(l.code ?? ""),
          productName: String(l.product_name ?? ""),
          variant: String(l.variant ?? ""),
          qty: Number(l.qty ?? 1),
          unitPricePaisa: Number(l.unit_price_paisa ?? 0),
          ownPrice: Boolean(l.own_price),
        }))
      : [],
    status: String(r.status ?? "open") as SalonPortalRequest["status"],
    orderId: r.order_id ? String(r.order_id) : null,
    reason: r.reason ? String(r.reason) : null,
  }));
}

export async function submitSalonRequest(input: {
  lines: Array<{ sku_id: string; qty: number }>;
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_submit_request", {
    p_client_id: ensureUuid(),
    p_lines: input.lines,
    p_note: input.note?.trim() || null,
  });
  throwIfRpcError(error, "Could not submit salon order request.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function editSalonRequest(input: {
  requestId: string;
  lines: Array<{ sku_id: string; qty: number }>;
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_edit_request", {
    p_client_id: ensureUuid(),
    p_request_id: ensureUuid(input.requestId),
    p_lines: input.lines,
    p_note: input.note?.trim() || null,
  });
  throwIfRpcError(error, "Could not update salon order request.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function cancelSalonRequest(requestId: string, reason?: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("salon_cancel_request", {
    p_request_id: ensureUuid(requestId),
    p_reason: reason?.trim() || "Cancelled by salon partner.",
  });
  throwIfRpcError(error, "Could not cancel salon order request.");
}

export async function fetchSalonMyOrders(): Promise<SalonPortalOrder[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_my_orders");
  throwIfRpcError(error, "Could not load official salon orders.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    orderId: String(r.order_id ?? ""),
    createdAt: String(r.created_at ?? ""),
    status: String(r.status ?? ""),
    plan: String(r.plan ?? "CASH"),
    subtotalPaisa: Number(r.subtotal_paisa ?? 0),
    discountPaisa: Number(r.discount_paisa ?? 0),
    totalPaisa: Number(r.total_paisa ?? 0),
    fromRequest: Boolean(r.from_request),
    waitingOn: r.waiting_on ? String(r.waiting_on) : null,
    lines: Array.isArray(r.lines)
      ? (r.lines as Array<Record<string, unknown>>).map((l) => ({
          lineNo: Number(l.line_no ?? 1),
          code: String(l.code ?? ""),
          productName: String(l.product_name ?? ""),
          variant: String(l.variant ?? ""),
          qty: Number(l.qty ?? 1),
          unitPricePaisa: Number(l.unit_price_paisa ?? 0),
        }))
      : [],
  }));
}

export async function fetchSalonMyAccount(): Promise<SalonAccountSummary> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_my_account");
  throwIfRpcError(error, "Could not load salon account ledger.");
  const r = (data ?? {}) as Record<string, unknown>;
  const b = (r.balance ?? {}) as Record<string, unknown>;
  return {
    balance: {
      invoicedPaisa: Number(b.invoiced_paisa ?? 0),
      paidPaisa: Number(b.paid_paisa ?? 0),
      balancePaisa: Number(b.balance_paisa ?? 0),
      overduePaisa: Number(b.overdue_paisa ?? 0),
      nextDueOn: b.next_due_on ? String(b.next_due_on) : null,
    },
    installments: Array.isArray(r.installments)
      ? (r.installments as Array<Record<string, unknown>>).map((i) => ({
          invoiceNumber: String(i.invoice_number ?? ""),
          seq: Number(i.seq ?? 1),
          ofCount: Number(i.of_count ?? 1),
          dueOn: String(i.due_on ?? ""),
          amountDuePaisa: Number(i.amount_due_paisa ?? 0),
          paidPaisa: Number(i.paid_paisa ?? 0),
          remainingPaisa: Number(i.remaining_paisa ?? 0),
          status: String(i.status ?? ""),
        }))
      : [],
    payments: Array.isArray(r.payments)
      ? (r.payments as Array<Record<string, unknown>>).map((p) => ({
          receiptNumber: String(p.receipt_number ?? ""),
          paidAt: String(p.paid_at ?? ""),
          method: String(p.method ?? "cash"),
          amountPaisa: Number(p.amount_paisa ?? 0),
        }))
      : [],
  };
}

export async function fetchSalonMyInvoices(): Promise<SalonInvoiceRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_my_invoices");
  throwIfRpcError(error, "Could not load salon invoices.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    invoiceId: String(r.invoice_id ?? ""),
    number: String(r.number ?? ""),
    issuedAt: String(r.issued_at ?? ""),
    totalPaisa: Number(r.total_paisa ?? 0),
    paidPaisa: Number(r.paid_paisa ?? 0),
    outstandingPaisa: Number(r.outstanding_paisa ?? 0),
  }));
}

export async function fetchSalonInvoiceDocument(invoiceId: string): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("salon_invoice_document", {
    p_invoice_id: ensureUuid(invoiceId),
  });
  throwIfRpcError(error, "Could not load invoice document.");
  return (data ?? {}) as Record<string, unknown>;
}

// =============================================================================
// Rep Bag, Blind Stock Issue Confirmations & Commission Statement
// =============================================================================

export async function fetchRepBagStock(): Promise<RepBagItem[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("my_bag");
  throwIfRpcError(error, "Could not load rep bag stock.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    skuId: String(r.sku_id ?? ""),
    code: String(r.code ?? ""),
    variant: String(r.variant ?? ""),
    onHand: Number(r.on_hand ?? 0),
  }));
}

export async function fetchRepPendingIssues(): Promise<RepPendingStockIssue[]> {
  const client = await requireClient();
  const [issuesRes, skusRes] = await Promise.all([
    client.schema("app").rpc("my_pending_issues"),
    client.schema("app").rpc("my_issue_skus"),
  ]);
  throwIfRpcError(issuesRes.error, "Could not load pending stock issues.");
  const skuMap = new Map<string, { skuId: string; code: string; variant: string }>();
  for (const s of (skusRes.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(s.sku_id ?? "");
    if (id) {
      skuMap.set(id, {
        skuId: id,
        code: String(s.code ?? ""),
        variant: String(s.variant ?? ""),
      });
    }
  }
  return ((issuesRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const skuIds = Array.isArray(r.sku_ids) ? r.sku_ids.map(String) : [];
    return {
      id: String(r.id ?? ""),
      direction: r.direction === "to_warehouse" ? "to_warehouse" : "to_rep",
      decisionNote: r.decision_note ? String(r.decision_note) : null,
      createdAt: String(r.created_at ?? ""),
      skuIds,
      skus: skuIds.map((id) => skuMap.get(id) ?? { skuId: id, code: id.slice(0, 8), variant: "" }),
    };
  });
}

export async function confirmRepStockIssue(
  issueId: string,
  counted: Array<{ sku_id: string; qty: number }>,
): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("rep_confirm_stock_issue", {
    p_issue_id: ensureUuid(issueId),
    p_counted: counted,
  });
  throwIfRpcError(error, "Could not confirm stock issue count.");
  return (data ?? {}) as Record<string, unknown>;
}

function mapCommissionJson(raw: unknown): CommissionStatement {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    repId: String(d.rep_id ?? ""),
    from: String(d.from ?? ""),
    to: String(d.to ?? ""),
    defaultRateBp: d.default_rate_bp !== null && d.default_rate_bp !== undefined ? Number(d.default_rate_bp) : null,
    earnedPaisa: Number(d.earned_paisa ?? 0),
    paidPaisa: Number(d.paid_paisa ?? 0),
    earnedToDatePaisa: Number(d.earned_to_date_paisa ?? 0),
    paidToDatePaisa: Number(d.paid_to_date_paisa ?? 0),
    owedPaisa: Number(d.owed_paisa ?? 0),
    invoiceCount: Number(d.invoice_count ?? 0),
    invoices: Array.isArray(d.invoices)
      ? (d.invoices as Array<Record<string, unknown>>).map((i) => ({
          invoiceId: String(i.invoice_id ?? ""),
          number: String(i.number ?? ""),
          issuedAt: String(i.issued_at ?? ""),
          salonName: String(i.salon_name ?? ""),
          totalPaisa: Number(i.total_paisa ?? 0),
          rateBp: Number(i.rate_bp ?? 0),
          commissionPaisa: Number(i.commission_paisa ?? 0),
        }))
      : [],
    payments: Array.isArray(d.payments)
      ? (d.payments as Array<Record<string, unknown>>).map((p) => ({
          paymentId: String(p.payment_id ?? ""),
          kind: p.kind === "reversal" ? "reversal" : "payment",
          amountPaisa: Number(p.amount_paisa ?? 0),
          note: p.note ? String(p.note) : null,
          reason: p.reason ? String(p.reason) : null,
          reversesId: p.reverses_id ? String(p.reverses_id) : null,
          reversed: Boolean(p.reversed),
          recordedAt: String(p.recorded_at ?? ""),
          recordedByName: String(p.recorded_by_name ?? ""),
        }))
      : [],
    salonRates: Array.isArray(d.salon_rates)
      ? (d.salon_rates as Array<Record<string, unknown>>).map((s) => ({
          salonId: String(s.salon_id ?? ""),
          salonName: String(s.salon_name ?? ""),
          rateBp: s.rate_bp !== null && s.rate_bp !== undefined ? Number(s.rate_bp) : null,
        }))
      : [],
  };
}

export async function fetchRepCommission(from: string, to: string): Promise<CommissionStatement> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("my_commission", {
    p_from: from,
    p_to: to,
  });
  throwIfRpcError(error, "Could not load commission statement.");
  return mapCommissionJson(data);
}

// =============================================================================
// Office Operations: Deliveries, Signatures, Pending Stock Returns, Official Orders
// =============================================================================

export async function fetchOfficePendingDeliveries(): Promise<OfficePendingDelivery[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_pending_deliveries");
  throwIfRpcError(error, "Could not load pending delivery submissions.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    submissionId: String(r.submission_id ?? ""),
    orderId: String(r.order_id ?? ""),
    salonId: String(r.salon_id ?? ""),
    salonName: String(r.salon_name ?? ""),
    repId: String(r.rep_id ?? ""),
    repName: String(r.rep_name ?? ""),
    lines: Array.isArray(r.lines)
      ? (r.lines as Array<Record<string, unknown>>).map((l) => ({
          skuId: String(l.sku_id ?? ""),
          code: String(l.code ?? ""),
          variant: String(l.variant ?? ""),
          qty: Number(l.qty ?? 1),
          unitPricePaisa: Number(l.unit_price_paisa ?? 0),
        }))
      : [],
    totalPaisa: Number(r.total_paisa ?? 0),
    receivedByName: String(r.received_by_name ?? ""),
    distanceFromPinM:
      r.distance_from_pin_m !== null && r.distance_from_pin_m !== undefined
        ? Number(r.distance_from_pin_m)
        : null,
    mockLocation: Boolean(r.mock_location),
    flags: r.flags && typeof r.flags === "object" ? (r.flags as Record<string, unknown>) : null,
    submittedAt: String(r.submitted_at ?? ""),
  }));
}

export async function fetchOfficeDeliverySignature(
  submissionId: string,
): Promise<DeliverySignatureStatus | null> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_delivery_signature", {
    p_submission_id: ensureUuid(submissionId),
  });
  throwIfRpcError(error, "Could not load delivery signature metadata.");
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    signatureId: r.signature_id ? String(r.signature_id) : null,
    outcome: r.outcome ? String(r.outcome) : null,
    signatoryName: r.signatory_name ? String(r.signatory_name) : null,
    signatoryDesignation: r.signatory_designation ? String(r.signatory_designation) : null,
    statementVersion: r.statement_version !== null && r.statement_version !== undefined ? Number(r.statement_version) : null,
    signedAt: r.signed_at ? String(r.signed_at) : null,
    note: r.note ? String(r.note) : null,
    valid: Boolean(r.valid),
    hasPicture: Boolean(r.has_picture),
  };
}

export async function fetchOfficeSignatureImage(
  signatureId: string,
  purpose = "Office delivery verification",
): Promise<string> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_signature_image", {
    p_signature_id: ensureUuid(signatureId),
    p_purpose: purpose,
  });
  throwIfRpcError(error, "Could not load delivery signature image.");
  const str = typeof data === "string" ? data : "";
  if (!str) return "";
  return str.startsWith("data:") ? str : `data:image/png;base64,${str}`;
}

export async function approveOfficeDelivery(submissionId: string): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_approve_delivery", {
    p_submission_id: ensureUuid(submissionId),
    p_client_id: ensureUuid(),
  });
  throwIfRpcError(error, "Could not approve delivery submission.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function rejectOfficeDelivery(submissionId: string, reason: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_reject_delivery", {
    p_submission_id: ensureUuid(submissionId),
    p_client_id: ensureUuid(),
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, "Could not reject delivery submission.");
}

export async function createOfficialOrderFromForecast(input: {
  salonId: string;
  plan: "CASH" | "INST2" | "INST4";
  lines: Array<{ sku_id: string; qty: number }>;
  assignedRepId?: string | null;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_create_order", {
    p_client_id: ensureUuid(),
    p_salon_id: ensureUuid(input.salonId),
    p_plan: input.plan,
    p_lines: input.lines,
    p_assigned_rep_id: input.assignedRepId ? ensureUuid(input.assignedRepId) : null,
    p_intake_card_id: null,
    p_card_version: null,
  });
  throwIfRpcError(error, "Could not create official sales order.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function fetchOfficePendingStock(): Promise<PendingReturnStockRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_pending_stock");
  throwIfRpcError(error, "Could not load unsettled pending stock.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    submissionId: String(r.submission_id ?? ""),
    repId: String(r.rep_id ?? ""),
    repName: String(r.rep_name ?? ""),
    salonName: String(r.salon_name ?? ""),
    skuId: String(r.sku_id ?? ""),
    skuCode: String(r.sku_code ?? ""),
    unsettled: Number(r.unsettled ?? 0),
    pendingLocationId: String(r.pending_location_id ?? ""),
    reason: String(r.reason ?? ""),
    decidedAt: String(r.decided_at ?? ""),
    requestId: r.request_id ? String(r.request_id) : null,
    requestStatus: r.request_status ? String(r.request_status) : null,
    requestMakerId: r.request_maker_id ? String(r.request_maker_id) : null,
    requestCheckerRole: (r.request_checker_role ? String(r.request_checker_role) : null) as UserRole | null,
    requestQty: r.request_qty !== null && r.request_qty !== undefined ? Number(r.request_qty) : null,
    requestDecisionReason: r.request_decision_reason ? String(r.request_decision_reason) : null,
  }));
}

export async function resolveOfficePendingStock(input: {
  submissionId: string;
  skuId: string;
  qty: number;
  outcome: "returned_to_bag" | "returned_to_warehouse" | "missing";
  note: string;
  warehouseId?: string | null;
  approvalId?: string | null;
}): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_resolve_pending", {
    p_client_id: ensureUuid(),
    p_submission_id: ensureUuid(input.submissionId),
    p_sku_id: ensureUuid(input.skuId),
    p_qty: Math.max(1, Math.round(input.qty)),
    p_outcome: input.outcome,
    p_note: input.note.trim(),
    p_warehouse_id: input.warehouseId ? ensureUuid(input.warehouseId) : null,
    p_approval_id: input.approvalId ? ensureUuid(input.approvalId) : null,
  });
  throwIfRpcError(error, "Could not settle pending stock.");
}

// =============================================================================
// Governance, Devices, Signups, Invitations, Maker-Checker Approvals, Pricing
// =============================================================================

export async function fetchOfficePendingSignups(): Promise<SalonSignupRequestRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_pending_signups");
  throwIfRpcError(error, "Could not load salon portal signups.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    requestId: String(r.request_id ?? ""),
    salonName: String(r.salon_name ?? ""),
    contactName: String(r.contact_name ?? ""),
    email: String(r.email ?? ""),
    type: String(r.type ?? "unisex") as SalonType,
    address: String(r.address ?? ""),
    createdAt: String(r.created_at ?? ""),
    similarSalons: Array.isArray(r.similar_salons)
      ? (r.similar_salons as Array<{ id: string; name: string; area_name: string }>)
      : [],
  }));
}

export async function decideOfficeSignup(input: {
  requestId: string;
  approve: boolean;
  reason: string;
  areaId?: string | null;
  existingSalonId?: string | null;
  repId?: string | null;
  rateBp?: number | null;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_decide_signup", {
    p_client_id: ensureUuid(),
    p_request_id: ensureUuid(input.requestId),
    p_approve: input.approve,
    p_reason: input.reason.trim(),
    p_area_id: input.areaId ? ensureUuid(input.areaId) : null,
    p_existing_salon_id: input.existingSalonId ? ensureUuid(input.existingSalonId) : null,
    p_rep_id: input.repId ? ensureUuid(input.repId) : null,
    p_rate_bp: typeof input.rateBp === "number" ? input.rateBp : null,
  });
  throwIfRpcError(error, "Could not decide salon signup request.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function fetchOfficeInvitations(): Promise<OfficeInvitationRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_invitations");
  throwIfRpcError(error, "Could not load invitations.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id ?? ""),
    kind: r.kind === "salon" ? "salon" : "rep",
    email: String(r.email ?? ""),
    fullName: String(r.full_name ?? ""),
    salonId: r.salon_id ? String(r.salon_id) : null,
    salonName: r.salon_name ? String(r.salon_name) : null,
    status: String(r.status ?? ""),
    expiresAt: String(r.expires_at ?? ""),
    invitedByName: String(r.invited_by_name ?? ""),
    createdAt: String(r.created_at ?? ""),
    redeemedAt: r.redeemed_at ? String(r.redeemed_at) : null,
    revokedAt: r.revoked_at ? String(r.revoked_at) : null,
  }));
}

export async function createOfficeInvitation(input: {
  kind: "rep" | "salon";
  fullName: string;
  email: string;
  salonId?: string | null;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_invite", {
    p_client_id: ensureUuid(),
    p_kind: input.kind,
    p_full_name: input.fullName.trim(),
    p_email: input.email.trim().toLowerCase(),
    p_salon_id: input.salonId ? ensureUuid(input.salonId) : null,
  });
  throwIfRpcError(error, "Could not create invitation.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function revokeOfficeInvitation(invitationId: string, reason: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_revoke_invitation", {
    p_invitation_id: ensureUuid(invitationId),
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, "Could not revoke invitation.");
}

export async function fetchOfficeDevices(): Promise<OfficeDeviceRow[]> {
  const client = await requireClient();
  const { data, error } = await client
    .from("device")
    .select("id, user_id, label, platform, status, created_at, approved_at, revoked_at, last_seen_at, user_profile!device_user_id_fkey(full_name, role)")
    .order("created_at", { ascending: false })
    .limit(100);
  throwIfRpcError(error, "Could not load staff devices.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((d) => {
    const prof = (Array.isArray(d.user_profile) ? d.user_profile[0] : d.user_profile) as {
      full_name?: string;
      role?: UserRole;
    } | null;
    return {
      id: String(d.id ?? ""),
      userId: String(d.user_id ?? ""),
      userName: String(prof?.full_name ?? "Staff Member"),
      userRole: prof?.role ?? "rep",
      label: d.label ? String(d.label) : null,
      platform: d.platform ? String(d.platform) : null,
      status: (String(d.status ?? "pending") as OfficeDeviceRow["status"]),
      createdAt: String(d.created_at ?? ""),
      approvedAt: d.approved_at ? String(d.approved_at) : null,
      revokedAt: d.revoked_at ? String(d.revoked_at) : null,
      lastSeenAt: d.last_seen_at ? String(d.last_seen_at) : null,
    };
  });
}

export async function decideOfficeDevice(
  deviceRowId: string,
  approve: boolean,
  reason: string,
): Promise<void> {
  const client = await requireClient();
  const rpcName = approve ? "approve_device" : "revoke_device";
  const { error } = await client.schema("app").rpc(rpcName, {
    p_device_id: ensureUuid(deviceRowId),
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, approve ? "Could not approve device." : "Could not revoke device.");
}

export async function fetchOfficePendingApprovals(): Promise<OfficeApprovalRequestRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_pending_approvals");
  throwIfRpcError(error, "Could not load pending approval requests.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    requestId: String(r.request_id ?? ""),
    kind: String(r.kind ?? ""),
    status: String(r.status ?? "pending") as OfficeApprovalRequestRow["status"],
    subjectType: String(r.subject_type ?? ""),
    subjectId: String(r.subject_id ?? ""),
    madeByMe: Boolean(r.made_by_me),
    makerName: String(r.maker_name ?? ""),
    checkerRoleRequired: (String(r.checker_role_required ?? "manager") as UserRole),
    reason: String(r.reason ?? ""),
    createdAt: String(r.created_at ?? ""),
    orderStatus: r.order_status ? String(r.order_status) : null,
    salonId: r.salon_id ? String(r.salon_id) : null,
    salonName: r.salon_name ? String(r.salon_name) : null,
    subtotalPaisa: r.subtotal_paisa !== null && r.subtotal_paisa !== undefined ? Number(r.subtotal_paisa) : null,
    discountPaisa: r.discount_paisa !== null && r.discount_paisa !== undefined ? Number(r.discount_paisa) : null,
    totalPaisa: r.total_paisa !== null && r.total_paisa !== undefined ? Number(r.total_paisa) : null,
    locationName: r.location_name ? String(r.location_name) : null,
    locationKind: r.location_kind ? String(r.location_kind) : null,
    skuId: r.sku_id ? String(r.sku_id) : null,
    skuCode: r.sku_code ? String(r.sku_code) : null,
    qtyDelta: r.qty_delta !== null && r.qty_delta !== undefined ? Number(r.qty_delta) : null,
  }));
}

export async function decideOfficeApproval(
  requestId: string,
  approve: boolean,
  reason: string,
): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("decide_approval", {
    p_request_id: ensureUuid(requestId),
    p_approve: approve,
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, "Could not decide approval request.");
}

export async function assignSalonRep(
  salonId: string,
  repId: string | null,
  rateBp?: number | null,
): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_assign_salon_rep", {
    p_client_id: ensureUuid(),
    p_salon_id: ensureUuid(salonId),
    p_rep_id: repId ? ensureUuid(repId) : null,
    p_rate_bp: typeof rateBp === "number" ? rateBp : null,
  });
  throwIfRpcError(error, "Could not assign salon representative.");
}

export async function setOfficeSalonPrice(
  salonId: string,
  skuId: string,
  pricePkr: number,
  reason: string,
): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_set_salon_price", {
    p_client_id: ensureUuid(),
    p_salon_id: ensureUuid(salonId),
    p_sku_id: ensureUuid(skuId),
    p_price_paisa: pkrToPaisa(pricePkr),
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, "Could not set salon-specific SKU price.");
}

export async function setOfficeMemberStatus(
  kind: "staff" | "salon",
  memberId: string,
  status: string,
  reason: string,
): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_set_member_status", {
    p_kind: kind,
    p_member_id: ensureUuid(memberId),
    p_status: status,
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, "Could not update member status.");
}

export async function fetchStaffUsers(): Promise<Array<{ id: string; fullName: string; role: UserRole; status: string }>> {
  const client = await requireClient();
  const { data, error } = await client
    .from("user_profile")
    .select("id, full_name, role, status")
    .order("full_name");
  throwIfRpcError(error, "Could not load staff directory.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((u) => ({
    id: String(u.id ?? ""),
    fullName: String(u.full_name ?? "Staff"),
    role: (String(u.role ?? "rep") as UserRole),
    status: String(u.status ?? "active"),
  }));
}

// =============================================================================
// Inventory Architecture (Locations, Balances, Stock Issues, Adjustments, Rules)
// =============================================================================

export async function fetchStockLocations(): Promise<StockLocationRow[]> {
  const client = await requireClient();
  const { data, error } = await client
    .from("stock_location")
    .select("id, name, kind, owner_user_id, active")
    .eq("active", true)
    .order("kind");
  throwIfRpcError(error, "Could not load stock locations.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
    id: String(l.id ?? ""),
    name: String(l.name ?? "Location"),
    kind: (String(l.kind ?? "warehouse") as StockLocationRow["kind"]),
    ownerUserId: l.owner_user_id ? String(l.owner_user_id) : null,
    active: Boolean(l.active),
  }));
}

export async function fetchStockBalances(locationId?: string | null): Promise<StockBalanceRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("stock_on_hand", {
    p_location_id: locationId ? ensureUuid(locationId) : null,
  });
  throwIfRpcError(error, "Could not load stock balances.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    locationId: String(r.location_id ?? ""),
    skuId: String(r.sku_id ?? ""),
    onHand: Number(r.on_hand ?? 0),
  }));
}

export async function fetchLowStockAlerts(): Promise<LowStockAlertRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("low_stock");
  throwIfRpcError(error, "Could not load reorder alerts.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    skuId: String(r.sku_id ?? ""),
    code: String(r.code ?? ""),
    onHand: Number(r.on_hand ?? 0),
    reorderPoint: Number(r.reorder_point ?? 0),
  }));
}

export async function proposeOfficeStockIssue(input: {
  direction: "to_rep" | "to_warehouse";
  warehouseId: string;
  bagId: string;
  lines: Array<{ sku_id: string; qty: number }>;
  routeDate?: string | null;
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_propose_stock_issue", {
    p_client_id: ensureUuid(),
    p_direction: input.direction,
    p_warehouse_id: ensureUuid(input.warehouseId),
    p_bag_id: ensureUuid(input.bagId),
    p_lines: input.lines,
    p_route_date: input.routeDate || null,
    p_note: input.note?.trim() || null,
  });
  throwIfRpcError(error, "Could not propose stock issue.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function ownerAdjustStock(input: {
  locationId: string;
  skuId: string;
  qtyDelta: number;
  reason: string;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("owner_adjust_stock", {
    p_client_id: ensureUuid(),
    p_location_id: ensureUuid(input.locationId),
    p_sku_id: ensureUuid(input.skuId),
    p_qty_delta: Math.round(input.qtyDelta),
    p_reason: input.reason.trim(),
  });
  throwIfRpcError(error, "Could not adjust stock.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function setOfficeReorderPoint(skuId: string, reorderPoint: number): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_set_reorder_point", {
    p_sku_id: ensureUuid(skuId),
    p_reorder_point: Math.max(0, Math.round(reorderPoint)),
  });
  throwIfRpcError(error, "Could not update reorder point.");
}

export async function fetchProductGroups(): Promise<ProductGroupRow[]> {
  const client = await requireClient();
  const { data, error } = await client
    .from("product_group")
    .select("id, name, default_cycle_days, active")
    .eq("active", true)
    .order("name");
  throwIfRpcError(error, "Could not load product groups.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((g) => ({
    id: String(g.id ?? ""),
    name: String(g.name ?? ""),
    defaultCycleDays: Number(g.default_cycle_days ?? 30),
    active: Boolean(g.active),
  }));
}

// =============================================================================
// Office Commission & Invoices / Receipts
// =============================================================================

export async function fetchOfficeCommissionReps(from: string, to: string): Promise<OfficeCommissionRepSummary[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_commission_reps", {
    p_from: from,
    p_to: to,
  });
  throwIfRpcError(error, "Could not load rep commission summary.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    repId: String(r.rep_id ?? ""),
    fullName: String(r.full_name ?? ""),
    status: String(r.status ?? "active"),
    defaultRateBp: r.default_rate_bp !== null && r.default_rate_bp !== undefined ? Number(r.default_rate_bp) : null,
    earnedPaisa: Number(r.earned_paisa ?? 0),
    paidPaisa: Number(r.paid_paisa ?? 0),
    owedPaisa: Number(r.owed_paisa ?? 0),
  }));
}

export async function fetchOfficeCommission(repId: string, from: string, to: string): Promise<CommissionStatement> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_commission", {
    p_rep_id: ensureUuid(repId),
    p_from: from,
    p_to: to,
  });
  throwIfRpcError(error, "Could not load rep commission ledger.");
  return mapCommissionJson(data);
}

export async function setOfficeCommissionRate(repId: string, rateBp: number, reason: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_set_commission_rate", {
    p_client_id: ensureUuid(),
    p_rep_id: ensureUuid(repId),
    p_rate_bp: Math.round(rateBp),
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, "Could not update commission rate.");
}

export async function recordOfficeCommissionPayment(
  repId: string,
  amountPkr: number,
  note?: string,
): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_record_commission_payment", {
    p_client_id: ensureUuid(),
    p_rep_id: ensureUuid(repId),
    p_amount_paisa: pkrToPaisa(amountPkr),
    p_note: note?.trim() || null,
  });
  throwIfRpcError(error, "Could not record commission payment.");
}

export async function reverseOfficeCommissionPayment(paymentId: string, reason: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_reverse_commission_payment", {
    p_client_id: ensureUuid(),
    p_payment_id: ensureUuid(paymentId),
    p_reason: reason.trim(),
  });
  throwIfRpcError(error, "Could not reverse commission payment.");
}

export async function fetchOfficeInvoices(salonId?: string | null): Promise<
  Array<{
    invoiceId: string;
    number: string;
    issuedAt: string;
    salonId: string;
    salonName: string;
    orderId: string;
    totalPaisa: number;
  }>
> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_invoices", {
    p_salon_id: salonId ? ensureUuid(salonId) : null,
  });
  throwIfRpcError(error, "Could not load office invoices.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((i) => ({
    invoiceId: String(i.invoice_id ?? ""),
    number: String(i.number ?? ""),
    issuedAt: String(i.issued_at ?? ""),
    salonId: String(i.salon_id ?? ""),
    salonName: String(i.salon_name ?? ""),
    orderId: String(i.order_id ?? ""),
    totalPaisa: Number(i.total_paisa ?? 0),
  }));
}

export async function fetchInvoiceDocument(invoiceId: string): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("invoice_document", {
    p_invoice_id: ensureUuid(invoiceId),
  });
  throwIfRpcError(error, "Could not load invoice document.");
  return (data ?? {}) as Record<string, unknown>;
}

// =============================================================================
// Owner Investor Ledger (Manual Decisions & Manual Payouts Only — NO AUTO ROI)
// =============================================================================

export async function fetchOfficeInvestors(): Promise<InvestorSummaryRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_investors");
  throwIfRpcError(error, "Could not load investor ledger.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    investorId: r.investor_id ? String(r.investor_id) : null,
    fullName: String(r.full_name ?? "Total"),
    phone: r.phone ? String(r.phone) : null,
    status: r.status ? String(r.status) : null,
    isTotal: Boolean(r.is_total),
    investedPaisa: Number(r.invested_paisa ?? 0),
    principalReturnedPaisa: Number(r.principal_returned_paisa ?? 0),
    principalOutstandingPaisa: Number(r.principal_outstanding_paisa ?? 0),
    profitDecidedPaisa: Number(r.profit_decided_paisa ?? 0),
    profitPaidPaisa: Number(r.profit_paid_paisa ?? 0),
    profitOwedPaisa: Number(r.profit_owed_paisa ?? 0),
  }));
}

export async function fetchInvestorInvestments(investorId: string): Promise<InvestorInvestmentRow[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_investor_investments", {
    p_investor_id: ensureUuid(investorId),
  });
  throwIfRpcError(error, "Could not load investor tranches.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    investmentId: String(r.investment_id ?? ""),
    investedOn: String(r.invested_on ?? ""),
    note: r.note ? String(r.note) : null,
    recordedAt: String(r.recorded_at ?? ""),
    reversed: Boolean(r.reversed),
    investedPaisa: Number(r.invested_paisa ?? 0),
    principalReturnedPaisa: Number(r.principal_returned_paisa ?? 0),
    principalOutstandingPaisa: Number(r.principal_outstanding_paisa ?? 0),
    profitDecidedPaisa: Number(r.profit_decided_paisa ?? 0),
    profitPaidPaisa: Number(r.profit_paid_paisa ?? 0),
    profitOwedPaisa: Number(r.profit_owed_paisa ?? 0),
  }));
}

export async function fetchInvestorStatement(
  investorId: string,
  from?: string | null,
  to?: string | null,
): Promise<InvestorStatementEntry[]> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_investor_statement", {
    p_investor_id: ensureUuid(investorId),
    p_from: from || null,
    p_to: to || null,
  });
  throwIfRpcError(error, "Could not load investor statement.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    entryKind: String(r.entry_kind ?? ""),
    entryId: String(r.entry_id ?? ""),
    investmentId: String(r.investment_id ?? ""),
    entryOn: String(r.entry_on ?? ""),
    payoutKind: r.payout_kind ? (String(r.payout_kind) as "principal" | "profit") : null,
    method: r.method ? (String(r.method) as "cash" | "bank") : null,
    reference: r.reference ? String(r.reference) : null,
    amountPaisa: Number(r.amount_paisa ?? 0),
    note: r.note ? String(r.note) : null,
    reason: r.reason ? String(r.reason) : null,
    reversesId: r.reverses_id ? String(r.reverses_id) : null,
    reversed: Boolean(r.reversed),
    recordedByName: String(r.recorded_by_name ?? ""),
    recordedAt: String(r.recorded_at ?? ""),
    principalOutstandingPaisa: Number(r.principal_outstanding_paisa ?? 0),
    profitOwedPaisa: Number(r.profit_owed_paisa ?? 0),
  }));
}

export async function createOfficeInvestor(input: {
  fullName: string;
  phone?: string;
  note?: string;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_create_investor", {
    p_client_id: ensureUuid(),
    p_full_name: input.fullName.trim(),
    p_phone: input.phone?.trim() || null,
    p_note: input.note?.trim() || null,
  });
  throwIfRpcError(error, "Could not create investor record.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function addOfficeInvestment(input: {
  investorId: string;
  amountPkr: number;
  investedOn: string;
  note?: string;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_add_investment", {
    p_client_id: ensureUuid(),
    p_investor_id: ensureUuid(input.investorId),
    p_amount_paisa: pkrToPaisa(input.amountPkr),
    p_invested_on: input.investedOn,
    p_note: input.note?.trim() || null,
  });
  throwIfRpcError(error, "Could not add investment.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function decideInvestorProfit(input: {
  investmentId: string;
  amountPkr: number;
  decidedOn: string;
  note?: string;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_decide_profit", {
    p_client_id: ensureUuid(),
    p_investment_id: ensureUuid(input.investmentId),
    p_amount_paisa: pkrToPaisa(input.amountPkr),
    p_decided_on: input.decidedOn,
    p_note: input.note?.trim() || null,
  });
  throwIfRpcError(error, "Could not record manual profit decision.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function recordInvestorPayout(input: {
  investmentId: string;
  kind: "profit" | "principal";
  method: "cash" | "bank" | "other";
  amountPkr: number;
  paidOn: string;
  reference?: string;
  note?: string;
}): Promise<Record<string, unknown>> {
  const client = await requireClient();
  const { data, error } = await client.schema("app").rpc("office_record_payout", {
    p_client_id: ensureUuid(),
    p_investment_id: ensureUuid(input.investmentId),
    p_kind: input.kind,
    p_method: input.method,
    p_amount_paisa: pkrToPaisa(input.amountPkr),
    p_paid_on: input.paidOn,
    p_reference: input.reference?.trim() || null,
    p_note: input.note?.trim() || null,
  });
  throwIfRpcError(error, "Could not record investor payout.");
  return (data ?? {}) as Record<string, unknown>;
}

export async function reverseInvestorEntry(input: {
  entryKind: string;
  entryId: string;
  reason: string;
}): Promise<void> {
  const client = await requireClient();
  const { error } = await client.schema("app").rpc("office_reverse_investor_entry", {
    p_client_id: ensureUuid(),
    p_entry_kind: input.entryKind,
    p_entry_id: ensureUuid(input.entryId),
    p_reason: input.reason.trim(),
  });
  throwIfRpcError(error, "Could not reverse investor entry.");
}


