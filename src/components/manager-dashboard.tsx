import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  Check,
  ClipboardCheck,
  Coins,
  Download,
  FileSpreadsheet,
  Layers,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  Store,
  X,
  BellRing,
  BookOpen,
} from "lucide-react";
import {
  apiFetch,
  fetchManagerOverview,
  getAuthMode,
  resendDeliveryNotification,
  submitManagerApproval,
} from "../lib/api";
import { canManageCatalog, getSkuBrand } from "../lib/catalog";
import type { SKU } from "../lib/data";
import { downloadDeliveryOrdersCsv } from "../lib/csv";
import { computeManagerQuickSnapshot } from "../lib/manager-snapshot";
import {
  summarizeSelectedOrderCards,
  type OrderCardBulkDecision,
} from "../lib/order-card-bulk";
import { SALON_SORT_OPTIONS, sortSalons, type SalonSortKey } from "../lib/salon-sort";
import { when } from "../lib/time";
import { ensureUuid } from "../lib/supabase-kiran";
import { getSupabaseClient } from "../lib/supabase";
import { ManagerLedgerView } from "./manager-ledger-view";
import { SalonRestockAlerts } from "./salon-restock-alerts";
import { ProductCatalogDrawer } from "./product-catalog-drawer";
import { ProductThumbnail } from "./product-thumbnail";
import type {
  DeliveryOrderFull,
  ManagerApprovalAction,
  ManagerOverviewPayload,
  OrderCardRecord,
  PaymentRecord,
  UserRole,
} from "../server/types";
import {
  ConfirmBulkDeliveredModal,
  ConfirmDeliveredModal,
  DeliveryBulkBar,
  DeliveryQuickActionsMenu,
  DeliveryReceiptModal,
} from "./delivery-actions";
import { DeliveryTrendsChart } from "./delivery-trends-chart";
import { ConfirmBulkOrderCardsModal, OrderCardBulkBar } from "./order-card-bulk";
import { SalonBulkImportModal } from "./salon-bulk-import-modal";

interface ManagerDashboardProps {
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
  onApprovedChange?: () => void;
  userRole?: UserRole;
}

type ManagerSection = "approvals" | "ledger" | "salon-stock" | "collections" | "orders" | "inventory";

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({
  showToast,
  onApprovedChange,
  userRole = "manager",
}) => {
  const [section, setSection] = useState<ManagerSection>("approvals");
  const [data, setData] = useState<ManagerOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [salonQuery, setSalonQuery] = useState("");
  const [salonSort, setSalonSort] = useState<SalonSortKey>("name_asc");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState<"all" | "pending_delivery" | "delivered">("all");
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [bulkConfirmOrders, setBulkConfirmOrders] = useState<DeliveryOrderFull[]>([]);
  const [markingBulkDelivered, setMarkingBulkDelivered] = useState(false);
  const [openActionMenuOrderId, setOpenActionMenuOrderId] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<DeliveryOrderFull | null>(null);
  const [confirmDeliverOrder, setConfirmDeliverOrder] = useState<DeliveryOrderFull | null>(null);
  const [markingDelivered, setMarkingDelivered] = useState(false);
  const [notifyingOrderId, setNotifyingOrderId] = useState<string | null>(null);
  const [cardBulkMode, setCardBulkMode] = useState(false);
  const [selectedOrderCardIds, setSelectedOrderCardIds] = useState<string[]>([]);
  const [bulkCardConfirm, setBulkCardConfirm] = useState<{
    cards: OrderCardRecord[];
    decision: OrderCardBulkDecision;
  } | null>(null);
  const [processingBulkCards, setProcessingBulkCards] = useState(false);
  const [catalogModalState, setCatalogModalState] = useState<{
    open: boolean;
    editSku: SKU | null;
    createMode: boolean;
  }>({ open: false, editSku: null, createMode: false });

  // Manager/Owner Off-App Paid Settlement & Audit Reversal modals
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    salonId: string;
    method: "bank_transfer" | "cash";
    amountPkr: string;
    bankName: string;
    bankReference: string;
  }>({
    open: false,
    salonId: "",
    method: "bank_transfer",
    amountPkr: "",
    bankName: "",
    bankReference: "",
  });
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [reverseModalPayment, setReverseModalPayment] = useState<PaymentRecord | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [submittingReversal, setSubmittingReversal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await fetchManagerOverview();
      setData(overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Office Manager overview.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const runAction = async (action: ManagerApprovalAction) => {
    setBusyId("id" in action ? action.id : action.ids[0] ?? null);
    try {
      const res = await submitManagerApproval(action);
      showToast(res.message, "ok");
      await load();
      onApprovedChange?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed.", "warn");
    } finally {
      setBusyId(null);
    }
  };

  const handleResendDeliveryNotification = async (order: DeliveryOrderFull) => {
    setNotifyingOrderId(order.id);
    try {
      const res = await resendDeliveryNotification(order.id);
      showToast(res.message, "ok");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not resend order notification.", "warn");
    } finally {
      setNotifyingOrderId(null);
    }
  };

  const handleConfirmMarkDelivered = async (order: DeliveryOrderFull) => {
    setMarkingDelivered(true);
    try {
      const res = await submitManagerApproval({
        action: "mark_delivery_delivered",
        id: order.id,
      });
      setConfirmDeliverOrder(null);
      setSelectedDeliveryIds((prev) => prev.filter((id) => id !== order.id));
      showToast(res.message, "ok");
      await load();
      onApprovedChange?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update delivery status.", "warn");
    } finally {
      setMarkingDelivered(false);
    }
  };

  const handleConfirmBulkMarkDelivered = async (targetOrders: DeliveryOrderFull[]) => {
    const ids = targetOrders.map((o) => o.id);
    if (ids.length === 0) return;
    setMarkingBulkDelivered(true);
    try {
      const res = await submitManagerApproval({
        action: "mark_deliveries_delivered",
        ids,
      });
      const idSet = new Set(ids);
      setSelectedDeliveryIds((prev) => prev.filter((id) => !idSet.has(id)));
      setBulkConfirmOrders([]);
      showToast(res.message, "ok");
      await load();
      onApprovedChange?.();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update selected delivery orders.",
        "warn",
      );
    } finally {
      setMarkingBulkDelivered(false);
    }
  };

  const handleConfirmBulkOrderCards = async (
    targetCards: OrderCardRecord[],
    decision: OrderCardBulkDecision,
  ) => {
    const ids = targetCards.map((c) => c.id);
    if (ids.length === 0) return;
    setProcessingBulkCards(true);
    try {
      const res = await submitManagerApproval({
        action: "bulk_process_order_cards",
        ids,
        decision,
      });
      const idSet = new Set(ids);
      setSelectedOrderCardIds((prev) => prev.filter((id) => !idSet.has(id)));
      setBulkCardConfirm(null);
      setCardBulkMode(false);
      showToast(res.message, "ok");
      await load();
      onApprovedChange?.();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to process selected order intake cards.",
        "warn",
      );
    } finally {
      setProcessingBulkCards(false);
    }
  };

  const openRecordPaymentModal = (salonId?: string, suggestedBalance?: number) => {
    const defaultSalon = salonId || data?.salons[0]?.id || "";
    const suggested =
      suggestedBalance && suggestedBalance > 0
        ? String(suggestedBalance)
        : "";
    setPaymentModal({
      open: true,
      salonId: defaultSalon,
      method: "bank_transfer",
      amountPkr: suggested,
      bankName: "",
      bankReference: "",
    });
  };

  const handleSubmitOfficePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountPkr = Math.round(Number(paymentModal.amountPkr));
    if (!paymentModal.salonId || !Number.isFinite(amountPkr) || amountPkr <= 0) {
      showToast("Enter a valid positive PKR settlement amount.", "warn");
      return;
    }
    if (paymentModal.method === "bank_transfer") {
      if (paymentModal.bankName.trim().length < 2) {
        showToast("Enter the Bank Name (at least 2 characters).", "warn");
        return;
      }
      if (paymentModal.bankReference.trim().length < 3) {
        showToast("Enter the IBFT / Bank Transfer Reference (at least 3 characters).", "warn");
        return;
      }
    }

    setSubmittingPayment(true);
    try {
      const res = await submitManagerApproval({
        action: "record_office_payment",
        salonId: paymentModal.salonId,
        method: paymentModal.method,
        amountPkr,
        bankName: paymentModal.method === "bank_transfer" ? paymentModal.bankName.trim() : undefined,
        bankReference:
          paymentModal.method === "bank_transfer" ? paymentModal.bankReference.trim() : undefined,
      });
      setPaymentModal((prev) => ({ ...prev, open: false }));
      showToast(res.message, "ok");
      await load();
      onApprovedChange?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not record off-app settlement.", "warn");
    } finally {
      setSubmittingPayment(false);
    }
  };

  const handleConfirmReversePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseModalPayment) return;
    const reason = reverseReason.trim();
    if (reason.length < 5 || reason.length > 300) {
      showToast("Audit reversal reason must be between 5 and 300 characters.", "warn");
      return;
    }

    setSubmittingReversal(true);
    try {
      const res = await submitManagerApproval({
        action: "reverse_office_payment",
        paymentId: reverseModalPayment.id,
        reason,
      });
      setReverseModalPayment(null);
      setReverseReason("");
      showToast(res.message, "ok");
      await load();
      onApprovedChange?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not reverse payment.", "warn");
    } finally {
      setSubmittingReversal(false);
    }
  };

  const handleDraftRestockCard = async (card: {
    salonId: string;
    salonName: string;
    skuId: string;
    skuName: string;
    qty: number;
    unitPrice: number;
    notes?: string;
  }) => {
    const cardId = `crd-${Date.now()}`;
    if (getAuthMode() === "supabase") {
      const client = await getSupabaseClient();
      if (client) {
        const { error } = await client.schema("app").rpc("rep_create_card", {
          p_id: ensureUuid(),
          p_salon_id: ensureUuid(card.salonId),
          p_body: card.notes || `Proactive restock order: ${card.qty}x ${card.skuName}`,
          p_items: [
            {
              sku_id: ensureUuid(card.skuId),
              qty: card.qty,
              price_paisa: Math.round(card.unitPrice * 100),
            },
          ],
        });
        if (error) {
          throw new Error(error.message || "Failed to create restock card in Supabase.");
        }
      }
    } else {
      await apiFetch("/api/rpc/rep_create_card", {
        method: "POST",
        body: JSON.stringify({
          p_id: cardId,
          p_salon_id: card.salonId,
          p_sku_id: card.skuId,
          p_sku_name: card.skuName,
          p_qty: card.qty,
          p_total: card.unitPrice * card.qty,
          p_notes: card.notes || null,
          p_at_client: new Date().toISOString(),
        }),
      });
    }
    await load();
    onApprovedChange?.();
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] animate-pulse"
            />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-[#211d1b] border border-rose-200 dark:border-rose-900 text-center space-y-3">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-4 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
        >
          Retry Loading
        </button>
      </div>
    );
  }

  if (!data) return null;

  const flaggedShifts = data.shifts.filter((s) => s.approvalStatus !== "approved");
  const pendingApprovalCount =
    data.pendingSalons.length + data.pendingOrderCards.length + flaggedShifts.length;
  const totalLostDemand = data.lostDemand.reduce((acc, d) => acc + d.qty, 0);
  const snapshot = computeManagerQuickSnapshot(data.salons, data.deliveryOrders);
  const filteredSalons = data.salons.filter(
    (s) =>
      s.name.toLowerCase().includes(salonQuery.toLowerCase()) ||
      s.area.toLowerCase().includes(salonQuery.toLowerCase()),
  );
  const sortedSalons = sortSalons(filteredSalons, salonSort);

  // Aggregate lost demand by SKU name
  const demandSummary = Object.entries(
    data.lostDemand.reduce<Record<string, number>>((acc, item) => {
      acc[item.skuName] = (acc[item.skuName] ?? 0) + item.qty;
      return acc;
    }, {}),
  );

  const isManagerOrOwner = userRole === "manager" || userRole === "owner";

  const managerTabs = [
    { id: "approvals" as const, label: `Approvals (${pendingApprovalCount})`, icon: ClipboardCheck },
    ...(isManagerOrOwner
      ? [
          { id: "ledger" as const, label: "Cash & Bank Ledger", icon: Coins },
          { id: "salon-stock" as const, label: "Salon Stock & Restock Alerts", icon: BellRing },
        ]
      : []),
    { id: "collections" as const, label: "Collections & Salons", icon: Building2 },
    { id: "orders" as const, label: `Shop & Deliveries (${data.shopOrders.length})`, icon: ShoppingBag },
    { id: "inventory" as const, label: "Warehouse Stock & Demand", icon: Package },
  ];

  return (
    <div className="space-y-5">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg text-[#1d1a19] dark:text-[#f2eeec]">
            Office Manager Operations
          </h2>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
            Approvals, Karachi salon receivables, khsalon.com orders &amp; catalog
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBulkImport(true)}
            className="px-3.5 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs hover:bg-[#66243d] whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Import Salons (Excel)</span>
          </button>

          <button
            type="button"
            onClick={() => void load()}
            className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a] whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh Ledger</span>
          </button>
        </div>
      </div>

      {/* Quick Snapshot */}
      <section
        aria-label="Quick Snapshot"
        className="rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] overflow-hidden"
      >
        <div className="px-4 py-2.5 border-b border-[#e6dfdb] dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
            Quick Snapshot
          </h3>
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
            <span>{snapshot.totalSalonsCount} salons</span>
            <span aria-hidden="true"> · </span>
            <span>
              {snapshot.totalPendingDeliveries + snapshot.totalDeliveredCount} delivery orders
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#e6dfdb] dark:divide-[#3a3330]">
          <div className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#6b625e] dark:text-[#a59b96]">
                Total Pending Deliveries
              </div>
              <div
                data-testid="snapshot-pending-deliveries"
                className="text-2xl font-bold tabular-nums mt-1 text-amber-700 dark:text-amber-300"
              >
                {snapshot.totalPendingDeliveries}
              </div>
              <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5 tabular-nums">
                PKR {snapshot.pendingDeliveriesValuePkr.toLocaleString()} awaiting dispatch ·{" "}
                {snapshot.totalDeliveredCount} delivered
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSection("orders")}
              className="min-h-[36px] px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:border-[#7a2e4a] whitespace-nowrap shrink-0 transition-colors"
            >
              View Ledger
            </button>
          </div>

          <div className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#6b625e] dark:text-[#a59b96]">
                Total Outstanding Balance
              </div>
              <div
                data-testid="snapshot-outstanding-balance"
                className="text-2xl font-bold tabular-nums mt-1 text-[#7a2e4a] dark:text-[#d77a9c]"
              >
                PKR {snapshot.totalOutstandingBalancePkr.toLocaleString()}
              </div>
              <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5 tabular-nums">
                Across {snapshot.salonsWithBalanceCount} of {snapshot.totalSalonsCount} salons
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSection("collections")}
              className="min-h-[36px] px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:border-[#7a2e4a] whitespace-nowrap shrink-0 transition-colors"
            >
              View Receivables
            </button>
          </div>
        </div>
      </section>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Pending Approvals</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[#1d1a19] dark:text-[#f2eeec]">
            {pendingApprovalCount}
          </div>
          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
            {data.pendingSalons.length} salons · {data.pendingOrderCards.length} cards · {flaggedShifts.length} shifts
          </div>
        </div>

        <div
          onClick={() => setSection("ledger")}
          className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] cursor-pointer hover:border-[#7a2e4a] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-[#6b625e] dark:text-[#a59b96]">
            <span>Off-App Settlements Ledger</span>
            <Coins className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
            PKR {data.stats.cashCollectedPkr.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#7a2e4a] dark:text-[#d77a9c] mt-0.5 font-medium">
            Open Cash &amp; Bank Ledger &rarr;
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Direct Shop Orders</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[#7a2e4a] dark:text-[#d77a9c]">
            {data.shopOrders.length}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
            {data.shopOrders.filter((o) => o.status === "pending").length} awaiting confirmation
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Lost Demand Units</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[#1d1a19] dark:text-[#f2eeec]">
            {totalLostDemand}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
            Across {demandSummary.length} requested SKUs
          </div>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {managerTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id)}
              className={`px-3.5 py-2 rounded-xl font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors min-h-[40px] ${
                section === tab.id
                  ? "bg-[#7a2e4a] text-white"
                  : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96] hover:border-[#7a2e4a]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================= SECTION 1: APPROVALS ================= */}
      {section === "approvals" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Prospect Salons */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Store className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Prospect Salons Review</span>
              </h3>
              <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                {data.pendingSalons.length} pending
              </span>
            </div>

            {data.pendingSalons.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                All registered salons have been reviewed.
              </div>
            ) : (
              <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                {data.pendingSalons.map((salon) => (
                  <div key={salon.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm">{salon.name}</div>
                        <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                          {salon.area} · {salon.contact_person} · {salon.phone}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 shrink-0">
                        Pending Review
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === salon.id}
                        onClick={() => runAction({ action: "approve_salon", id: salon.id, stage: "trial" })}
                        className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        Approve Trial
                      </button>
                      <button
                        type="button"
                        disabled={busyId === salon.id}
                        onClick={() => runAction({ action: "approve_salon", id: salon.id, stage: "regular" })}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        Approve Regular
                      </button>
                      <button
                        type="button"
                        disabled={busyId === salon.id}
                        onClick={() => runAction({ action: "reject_salon", id: salon.id })}
                        className="px-3 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium text-rose-600"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Order Intake Cards */}
          {(() => {
            const pendingCardIds = data.pendingOrderCards.map((c) => c.id);
            const pendingCardIdSet = new Set(pendingCardIds);
            const activeSelectedCardIds = selectedOrderCardIds.filter((id) =>
              pendingCardIdSet.has(id),
            );
            const activeSelectedCardSet = new Set(activeSelectedCardIds);
            const allCardsSelected =
              pendingCardIds.length > 0 &&
              pendingCardIds.every((id) => activeSelectedCardSet.has(id));
            const someCardsSelected = pendingCardIds.some((id) =>
              activeSelectedCardSet.has(id),
            );
            const selectedSummary = summarizeSelectedOrderCards(
              data.pendingOrderCards,
              activeSelectedCardIds,
            );

            const toggleSelectOrderCard = (cardId: string) => {
              setSelectedOrderCardIds((prev) =>
                prev.includes(cardId)
                  ? prev.filter((id) => id !== cardId)
                  : [...prev, cardId],
              );
            };

            const toggleSelectAllCards = () => {
              if (allCardsSelected) {
                setSelectedOrderCardIds([]);
              } else {
                setSelectedOrderCardIds(pendingCardIds);
              }
            };

            return (
              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                    <span>Order Intake Cards</span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                      {data.pendingOrderCards.length} pending
                    </span>
                    {data.pendingOrderCards.length > 0 && (
                      <button
                        type="button"
                        aria-pressed={cardBulkMode}
                        onClick={() => {
                          setCardBulkMode((prev) => {
                            if (prev) setSelectedOrderCardIds([]);
                            return !prev;
                          });
                        }}
                        className={`min-h-[34px] px-3 py-1 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                          cardBulkMode
                            ? "bg-[#7a2e4a] text-white border-[#7a2e4a]"
                            : "bg-white dark:bg-[#171413] border-[#e6dfdb] dark:border-[#3a3330] text-[#1d1a19] dark:text-[#f2eeec] hover:border-[#7a2e4a]"
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>{cardBulkMode ? "Cancel Bulk" : "Bulk Process"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {cardBulkMode && data.pendingOrderCards.length > 0 && (
                  <OrderCardBulkBar
                    pendingCount={data.pendingOrderCards.length}
                    selectedCount={selectedSummary.selectedCount}
                    selectedTotalPkr={selectedSummary.totalAmountPkr}
                    allSelected={allCardsSelected}
                    someSelected={someCardsSelected}
                    onToggleSelectAll={toggleSelectAllCards}
                    onOpenBulkModal={(decision) =>
                      setBulkCardConfirm({
                        cards: selectedSummary.selectedCards,
                        decision,
                      })
                    }
                  />
                )}

                {data.pendingOrderCards.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                    No pending order intake cards awaiting dispatch conversion.
                  </div>
                ) : (
                  <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                    {data.pendingOrderCards.map((card) => {
                      const isChecked = activeSelectedCardSet.has(card.id);
                      return (
                        <div key={card.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 min-w-0">
                              {cardBulkMode && (
                                <label
                                  aria-label={`Select order card for ${card.salonName || "Salon"}`}
                                  className="min-h-[36px] min-w-[26px] -ml-0.5 flex items-center justify-center cursor-pointer shrink-0"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleSelectOrderCard(card.id)}
                                    className="w-4 h-4 rounded accent-[#7a2e4a] cursor-pointer"
                                  />
                                </label>
                              )}
                              <div className="min-w-0">
                                <div className="font-bold text-sm">{card.salonName}</div>
                                <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                                  {card.qty}x {card.skuName} · {when(card.capturedAt)}
                                </div>
                                {card.notes && (
                                  <div className="mt-1 text-xs text-[#7a2e4a] dark:text-[#d77a9c] bg-[#faf7f5] dark:bg-[#171413] px-2.5 py-1.5 rounded-lg border border-[#e6dfdb]/80 dark:border-[#3a3330]">
                                    Note: {card.notes}
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="font-bold text-xs text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums shrink-0">
                              PKR {card.totalAmount.toLocaleString()}
                            </span>
                          </div>
                          {!cardBulkMode && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={busyId === card.id}
                                onClick={() =>
                                  runAction({ action: "approve_order_card", id: card.id })
                                }
                                className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Convert to Delivery</span>
                              </button>
                              <button
                                type="button"
                                disabled={busyId === card.id}
                                onClick={() =>
                                  runAction({ action: "reject_order_card", id: card.id })
                                }
                                className="px-3 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium text-rose-600 flex items-center gap-1"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Decline</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Rep Daily Check-Ins */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Rep Daily Check-Ins</span>
              </h3>
              <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                {data.shifts.length} recorded shifts
              </span>
            </div>

            {data.shifts.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No rep check-ins recorded yet. Check in from the Today tab to generate a shift log.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                      <th className="py-2 pr-3 font-semibold">Rep</th>
                      <th className="py-2 px-3 font-semibold">Checked In</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                      <th className="py-2 px-3 font-semibold">Closed At</th>
                      <th className="py-2 pl-3 font-semibold text-right">Approval</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                    {data.shifts.map((shift) => (
                      <tr key={shift.id}>
                        <td className="py-2.5 pr-3 font-semibold">{shift.repName}</td>
                        <td className="py-2.5 px-3 text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                          {when(shift.openedAt)}
                        </td>
                        <td className="py-2.5 px-3 capitalize">{shift.status}</td>
                        <td className="py-2.5 px-3 text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                          {shift.closedAt ? when(shift.closedAt) : "—"}
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          {shift.approvalStatus === "approved" ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                              Approved
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={busyId === shift.id}
                                onClick={() => runAction({ action: "approve_shift", id: shift.id })}
                                className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white font-semibold"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busyId === shift.id}
                                onClick={() => runAction({ action: "flag_shift", id: shift.id })}
                                className="px-2.5 py-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-rose-600 font-medium"
                              >
                                Flag
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= SECTION: CASH & BANK LEDGER ================= */}
      {section === "ledger" && isManagerOrOwner && (
        <ManagerLedgerView
          initialEntries={data.cashLedgerEntries}
          userRole={userRole}
          showToast={showToast}
          onRecordPaymentClick={() => openRecordPaymentModal()}
          onReversePaymentClick={(paymentId) => {
            const pay = data.recentPayments.find((p) => p.id === paymentId);
            if (pay) {
              setReverseModalPayment(pay);
              setReverseReason("");
            } else {
              showToast("Payment record not found.", "warn");
            }
          }}
          onViewReceipt={(receiptNumber) => {
            const order = data.deliveryOrders.find(
              (o) => o.order_number === receiptNumber || o.id === receiptNumber,
            );
            if (order) {
              setReceiptOrder(order);
            } else {
              showToast(`Receipt ${receiptNumber} on file.`, "info");
            }
          }}
        />
      )}

      {/* ================= SECTION: CLIENT SALON STOCK & RESTOCK ALERTS ================= */}
      {section === "salon-stock" && isManagerOrOwner && (
        <SalonRestockAlerts
          salons={data.salons}
          deliveries={data.deliveryOrders}
          skus={data.skus}
          userRole={userRole}
          showToast={showToast}
          onDraftRestockCard={handleDraftRestockCard}
        />
      )}

      {!isManagerOrOwner && (section === "ledger" || section === "salon-stock") && (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#211d1b] border border-amber-200 dark:border-amber-900/50 text-center space-y-2">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Access Restricted: Client Salon Stock and Cash Ledger are strictly reserved for Office Manager and Owner roles.
          </p>
          <button
            type="button"
            onClick={() => setSection("approvals")}
            className="px-4 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
          >
            Return to Operations
          </button>
        </div>
      )}

      {/* ================= SECTION 2: COLLECTIONS & SALONS ================= */}
      {section === "collections" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm">Salon Credit &amp; Receivables</h3>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-44">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-[#6b625e]" />
                  <input
                    type="text"
                    placeholder="Filter salons..."
                    value={salonQuery}
                    onChange={(e) => setSalonQuery(e.target.value)}
                    className="w-full min-h-[38px] pl-8 pr-3 py-1.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
                <div className="relative shrink-0">
                  <ArrowUpDown className="w-3.5 h-3.5 absolute left-2.5 top-3 text-[#6b625e] pointer-events-none" />
                  <select
                    aria-label="Sort manager salons by"
                    value={salonSort}
                    onChange={(e) => setSalonSort(e.target.value as SalonSortKey)}
                    className="min-h-[38px] pl-8 pr-3 py-1.5 text-xs font-medium rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec]"
                  >
                    {SALON_SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        Sort: {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {canManageCatalog(userRole) && (
                  <button
                    type="button"
                    data-testid="open-record-payment-btn"
                    onClick={() => openRecordPaymentModal()}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold hover:bg-[#66243d] flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Record Paid Settlement</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowBulkImport(true)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-black/5 dark:bg-white/5 text-xs font-semibold hover:border-[#7a2e4a] flex items-center gap-1 shrink-0 whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                  <span>Bulk Import</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                    <th className="py-2 pr-3 font-semibold">Salon</th>
                    <th className="py-2 px-3 font-semibold">Stage</th>
                    <th className="py-2 px-3 font-semibold text-right">Balance Due</th>
                    <th className="py-2 px-3 font-semibold text-right">Credit Limit</th>
                    {canManageCatalog(userRole) && (
                      <th className="py-2 pl-3 font-semibold text-right">Settlement</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                  {sortedSalons.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {s.area} · {s.last_visited_at ? `Visited ${when(s.last_visited_at)}` : "Never visited"}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 capitalize">{s.stage}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold tabular-nums ${
                          s.outstanding_balance > 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        PKR {s.outstanding_balance.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-[#6b625e] dark:text-[#a59b96]">
                        PKR {s.credit_limit.toLocaleString()}
                      </td>
                      {canManageCatalog(userRole) && (
                        <td className="py-2.5 pl-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSection("salon-stock");
                                setSalonQuery(s.name);
                              }}
                              title="Check Stock & Restock Alert"
                              className="px-2 py-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] hover:border-amber-500 text-[11px] font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap"
                            >
                              Stock Alert
                            </button>
                            <button
                              type="button"
                              onClick={() => openRecordPaymentModal(s.id, s.outstanding_balance)}
                              className="px-2.5 py-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] hover:border-[#7a2e4a] text-[11px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c] whitespace-nowrap"
                            >
                              Record Paid
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <div>
              <h3 className="font-bold text-sm">Verified Off-App Settlements</h3>
              <p className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
                Bank-to-Bank &amp; Cash-to-Cash notes approved by Office Manager or Owner (no in-app payments).
              </p>
            </div>
            {data.recentPayments.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No off-app settlements recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs">
                {data.recentPayments.map((pay) => {
                  const isBank = pay.method === "bank_transfer" || pay.method === "bank";
                  return (
                    <div key={pay.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold truncate">{pay.salonName || pay.salonId}</span>
                            {pay.receiptNumber && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                                {pay.receiptNumber}
                              </span>
                            )}
                            {pay.reversed && (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                                Reversed
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
                            {isBank ? "Bank-to-Bank" : "Cash-to-Cash"}
                            {pay.bankName ? ` · ${pay.bankName}` : ""}
                            {pay.bankReference ? ` (${pay.bankReference})` : ""}
                          </div>
                          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                            {when(pay.capturedAt)}
                            {pay.recordedByName ? ` · Approved by ${pay.recordedByName}` : ""}
                          </div>
                          {pay.reversed && pay.reversalReason && (
                            <div className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">
                              Reversal note: {pay.reversalReason}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                          <div
                            className={`font-bold tabular-nums ${
                              pay.reversed
                                ? "line-through text-rose-600/70 dark:text-rose-400/70"
                                : "text-emerald-700 dark:text-emerald-400"
                            }`}
                          >
                            +PKR {pay.amount.toLocaleString()}
                          </div>
                          {!pay.reversed && pay.mayReverse !== false && canManageCatalog(userRole) && (
                            <button
                              type="button"
                              data-testid={`reverse-payment-btn-${pay.id}`}
                              onClick={() => {
                                setReverseModalPayment(pay);
                                setReverseReason("");
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#e6dfdb] dark:border-[#3a3330] text-[10px] font-semibold text-rose-600 hover:border-rose-400"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>Reverse</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= SECTION 3: SHOP & DELIVERIES ================= */}
      {section === "orders" && (
        <div className="space-y-4">
          <DeliveryTrendsChart orders={data.deliveryOrders} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Public Storefront Orders */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">khsalon.com Direct Orders</h3>
              <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                {data.shopOrders.length} orders
              </span>
            </div>

            {data.shopOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No public storefront orders yet. Orders placed from the Shop tab appear here immediately.
              </div>
            ) : (
              <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs">
                {data.shopOrders.map((ord) => (
                  <div key={ord.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {ord.orderNumber} · {when(ord.createdAt)}
                        </div>
                        <div className="font-bold text-sm">{ord.customerName} ({ord.customerPhone})</div>
                        <div className="text-[#6b625e] dark:text-[#a59b96]">
                          {ord.qty}x {ord.productName} ({ord.shadeVariant})
                        </div>
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
                          Ship to: {ord.deliveryAddress}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                          PKR {ord.totalPkr.toLocaleString()}
                        </div>
                        <div className="text-[11px] font-semibold capitalize mt-0.5">{ord.status}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {ord.status === "pending" && (
                        <button
                          type="button"
                          disabled={busyId === ord.id}
                          onClick={() =>
                            runAction({
                              action: "update_shop_order_status",
                              id: ord.id,
                              status: "confirmed",
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white font-semibold"
                        >
                          Confirm Order
                        </button>
                      )}
                      {ord.status !== "dispatched" && (
                        <button
                          type="button"
                          disabled={busyId === ord.id}
                          onClick={() =>
                            runAction({
                              action: "update_shop_order_status",
                              id: ord.id,
                              status: "dispatched",
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold"
                        >
                          Mark Dispatched
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rep Delivery Orders */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            {(() => {
              const query = deliverySearch.trim().toLowerCase();
              const searchedDeliveries = query
                ? data.deliveryOrders.filter(
                    (o) =>
                      o.order_number.toLowerCase().includes(query) ||
                      o.id.toLowerCase().includes(query) ||
                      o.salon_name.toLowerCase().includes(query),
                  )
                : data.deliveryOrders;

              const allCount = searchedDeliveries.length;
              const pendingCount = searchedDeliveries.filter(
                (o) => o.status === "pending_delivery",
              ).length;
              const deliveredCount = searchedDeliveries.filter(
                (o) => o.status === "delivered",
              ).length;
              const filteredDeliveries =
                deliveryFilter === "all"
                  ? searchedDeliveries
                  : searchedDeliveries.filter((o) => o.status === deliveryFilter);

              const isManager = canManageCatalog(userRole);
              const visiblePendingIds = filteredDeliveries
                .filter((o) => o.status === "pending_delivery")
                .map((o) => o.id);
              const pendingIdSet = new Set(
                data.deliveryOrders
                  .filter((o) => o.status === "pending_delivery")
                  .map((o) => o.id),
              );
              const activeSelectedIds = selectedDeliveryIds.filter((id) => pendingIdSet.has(id));
              const activeSelectedSet = new Set(activeSelectedIds);
              const allVisiblePendingSelected =
                visiblePendingIds.length > 0 &&
                visiblePendingIds.every((id) => activeSelectedSet.has(id));
              const someVisiblePendingSelected = visiblePendingIds.some((id) =>
                activeSelectedSet.has(id),
              );

              const toggleSelectOrder = (orderId: string) => {
                setSelectedDeliveryIds((prev) =>
                  prev.includes(orderId)
                    ? prev.filter((id) => id !== orderId)
                    : [...prev, orderId],
                );
              };

              const toggleSelectAllVisiblePending = () => {
                if (visiblePendingIds.length === 0) return;
                if (allVisiblePendingSelected) {
                  const visibleSet = new Set(visiblePendingIds);
                  setSelectedDeliveryIds((prev) => prev.filter((id) => !visibleSet.has(id)));
                } else {
                  setSelectedDeliveryIds((prev) =>
                    Array.from(new Set([...prev, ...visiblePendingIds])),
                  );
                }
              };

              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-sm">Salon Delivery Ledger</h3>
                      <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                        {filteredDeliveries.length} of {allCount} deliveries
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        role="group"
                        aria-label="Filter salon delivery ledger by status"
                        className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#f1eae6] dark:bg-[#2a2523] border border-[#e6dfdb] dark:border-[#3a3330]"
                      >
                        {(
                          [
                            { id: "all", label: `All (${allCount})` },
                            { id: "pending_delivery", label: `Pending (${pendingCount})` },
                            { id: "delivered", label: `Delivered (${deliveredCount})` },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={deliveryFilter === opt.id}
                            onClick={() => setDeliveryFilter(opt.id)}
                            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors tabular-nums ${
                              deliveryFilter === opt.id
                                ? "bg-white dark:bg-[#171413] text-[#7a2e4a] dark:text-[#d77a9c] shadow-xs"
                                : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19] dark:hover:text-[#f2eeec]"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={filteredDeliveries.length === 0}
                        onClick={() => {
                          const filename = downloadDeliveryOrdersCsv(
                            filteredDeliveries,
                            data.salons,
                            deliveryFilter,
                          );
                          showToast(
                            `Exported ${filteredDeliveries.length} delivery order${filteredDeliveries.length === 1 ? "" : "s"} to ${filename}.`,
                            "ok",
                          );
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#171413] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a] disabled:opacity-45 whitespace-nowrap shrink-0 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                        <span>Export CSV</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-[#6b625e]" />
                      <input
                        type="text"
                        aria-label="Search salon delivery ledger"
                        placeholder="Search order ID or salon name..."
                        value={deliverySearch}
                        onChange={(e) => setDeliverySearch(e.target.value)}
                        className="w-full min-h-[38px] pl-8 pr-8 py-1.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                      />
                      {deliverySearch && (
                        <button
                          type="button"
                          aria-label="Clear ledger delivery search"
                          onClick={() => setDeliverySearch("")}
                          className="absolute right-1.5 top-1.5 p-1 rounded-lg text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isManager && (
                      <DeliveryBulkBar
                        checkboxId="manager-ledger-select-all"
                        visiblePendingCount={visiblePendingIds.length}
                        selectedCount={activeSelectedIds.length}
                        allVisiblePendingSelected={allVisiblePendingSelected}
                        someVisiblePendingSelected={someVisiblePendingSelected}
                        onToggleSelectAll={toggleSelectAllVisiblePending}
                        onMarkSelectedDelivered={() =>
                          setBulkConfirmOrders(
                            data.deliveryOrders.filter(
                              (o) =>
                                o.status === "pending_delivery" && activeSelectedSet.has(o.id),
                            ),
                          )
                        }
                      />
                    )}
                  </div>

                  {filteredDeliveries.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#6b625e] dark:text-[#a59b96] space-y-2">
                      <p>
                        {query
                          ? `No delivery orders matching "${deliverySearch.trim()}".`
                          : deliveryFilter === "delivered"
                            ? "No delivered orders yet."
                            : deliveryFilter === "pending_delivery"
                              ? "No pending delivery orders."
                              : "No delivery orders available."}
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        {query && (
                          <button
                            type="button"
                            onClick={() => setDeliverySearch("")}
                            className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a]"
                          >
                            Clear Search
                          </button>
                        )}
                        {deliveryFilter !== "all" && (
                          <button
                            type="button"
                            onClick={() => setDeliveryFilter("all")}
                            className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a]"
                          >
                            Show All Orders
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs">
                      {filteredDeliveries.map((ord) => {
                        const isPending = ord.status === "pending_delivery";
                        const isSelected = isPending && activeSelectedSet.has(ord.id);
                        return (
                          <div
                            key={ord.id}
                            className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-2"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              {isManager && isPending && (
                                <label
                                  aria-label={`Select ledger order ${ord.order_number}`}
                                  className="min-h-[36px] min-w-[26px] -ml-1 flex items-center justify-center cursor-pointer shrink-0"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelectOrder(ord.id)}
                                    className="w-4 h-4 rounded accent-[#7a2e4a] cursor-pointer"
                                  />
                                </label>
                              )}
                              <div className="min-w-0">
                                <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                  {ord.order_number}
                                </div>
                                <div className="font-bold text-sm">{ord.salon_name}</div>
                                <div className="text-[#6b625e] dark:text-[#a59b96]">
                                  {ord.items.map((i) => `${i.qty}x ${i.sku_name}`).join(", ")}
                                </div>
                                {ord.notes && (
                                  <div className="text-[11px] text-[#7a2e4a] dark:text-[#d77a9c] mt-0.5">
                                    Note: {ord.notes}
                                  </div>
                                )}
                                {ord.delivered_at && (
                                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                                    Delivered {when(ord.delivered_at)}
                                    {ord.signature_data
                                      ? " · Digital signature attached"
                                      : " · Confirmed by Owner / Manager"}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <div className="text-right">
                                <div className="font-bold tabular-nums">
                                  PKR {ord.total_amount.toLocaleString()}
                                </div>
                                <div
                                  className={`text-[11px] font-semibold mt-0.5 ${
                                    ord.status === "delivered"
                                      ? "text-emerald-700 dark:text-emerald-400"
                                      : "text-amber-700 dark:text-amber-300"
                                  }`}
                                >
                                  {ord.status === "delivered" ? "Delivered" : "Pending Delivery"}
                                </div>
                              </div>

                              <DeliveryQuickActionsMenu
                                order={ord}
                                isOpen={openActionMenuOrderId === ord.id}
                                onToggle={() =>
                                  setOpenActionMenuOrderId((prev) =>
                                    prev === ord.id ? null : ord.id,
                                  )
                                }
                                onClose={() => setOpenActionMenuOrderId(null)}
                                onViewReceipt={(o) => setReceiptOrder(o)}
                                onResendNotification={handleResendDeliveryNotification}
                                onRequestMarkDelivered={(o) => setConfirmDeliverOrder(o)}
                                canMarkDelivered={isManager}
                                isNotifying={notifyingOrderId === ord.id}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          </div>
        </div>
      )}

      {/* ================= SECTION 4: STOCK & DEMAND ================= */}
      {section === "inventory" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-sm">Warehouse &amp; Catalog SKU Inventory</h3>
                <p className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                  Lumex, Mocheqi Musk, and distribution stock synced to Take Order.
                </p>
              </div>
              {canManageCatalog(userRole) && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid="manager-browse-catalog-btn"
                    onClick={() =>
                      setCatalogModalState({ open: true, editSku: null, createMode: false })
                    }
                    className="px-2.5 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a] whitespace-nowrap"
                  >
                    Browse Catalog
                  </button>
                  <button
                    type="button"
                    data-testid="manager-add-product-btn"
                    onClick={() =>
                      setCatalogModalState({ open: true, editSku: null, createMode: true })
                    }
                    className="px-2.5 py-1.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add Product</span>
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                    <th className="py-2 pr-3 font-semibold">Product</th>
                    <th className="py-2 px-3 font-semibold">Line &amp; Volume</th>
                    <th className="py-2 px-3 font-semibold text-right">Price</th>
                    <th className="py-2 pl-3 font-semibold text-right">Stock Qty</th>
                    {canManageCatalog(userRole) && (
                      <th className="py-2 pl-3 font-semibold text-right">Edit</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                  {data.skus.map((sku) => (
                    <tr key={sku.id}>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2.5">
                          <ProductThumbnail sku={sku} className="w-10 h-10 rounded-lg" />
                          <div className="min-w-0">
                            <div className="font-semibold leading-snug">{sku.name}</div>
                            <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                              {sku.sku_code} · {sku.category}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium">{getSkuBrand(sku)}</div>
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {sku.volume_size ?? sku.unit}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                        PKR {sku.price.toLocaleString()}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-bold tabular-nums whitespace-nowrap">
                        {sku.bag_qty} {sku.unit}s
                      </td>
                      {canManageCatalog(userRole) && (
                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setCatalogModalState({ open: true, editSku: sku, createMode: false })
                            }
                            className="p-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] hover:text-[#7a2e4a] hover:border-[#7a2e4a]"
                            aria-label={`Edit ${sku.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-sm">Unstocked Lost Demand Report</h3>
            {demandSummary.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No lost demand requests logged yet.
              </div>
            ) : (
              <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs">
                {demandSummary.map(([skuName, totalQty]) => (
                  <div key={skuName} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                    <span className="font-semibold">{skuName}</span>
                    <span className="font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                      {totalQty} units requested
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <SalonBulkImportModal
        isOpen={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        onSuccess={() => {
          void load();
          onApprovedChange?.();
        }}
        showToast={showToast}
      />

      <DeliveryReceiptModal
        order={receiptOrder}
        salon={receiptOrder ? data.salons.find((s) => s.id === receiptOrder.salon_id) ?? null : null}
        onClose={() => setReceiptOrder(null)}
      />

      <ConfirmDeliveredModal
        order={confirmDeliverOrder}
        isSubmitting={markingDelivered}
        onCancel={() => setConfirmDeliverOrder(null)}
        onConfirm={handleConfirmMarkDelivered}
      />

      <ConfirmBulkDeliveredModal
        orders={bulkConfirmOrders}
        isSubmitting={markingBulkDelivered}
        onCancel={() => setBulkConfirmOrders([])}
        onConfirm={handleConfirmBulkMarkDelivered}
      />

      <ConfirmBulkOrderCardsModal
        cards={bulkCardConfirm?.cards ?? []}
        decision={bulkCardConfirm?.decision ?? null}
        isSubmitting={processingBulkCards}
        onChangeDecision={(decision) =>
          setBulkCardConfirm((prev) => (prev ? { ...prev, decision } : null))
        }
        onCancel={() => setBulkCardConfirm(null)}
        onConfirm={handleConfirmBulkOrderCards}
      />

      <ProductCatalogDrawer
        isOpen={catalogModalState.open}
        onClose={() => setCatalogModalState({ open: false, editSku: null, createMode: false })}
        skus={data.skus}
        userRole={userRole}
        initialEditSku={catalogModalState.editSku}
        startInCreateMode={catalogModalState.createMode}
        onCatalogUpdated={async () => {
          await load();
          onApprovedChange?.();
        }}
        showToast={showToast}
      />

      {/* Off-App Paid Settlement Modal (Manager / Owner Only) */}
      {paymentModal.open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="office-payment-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <form
            onSubmit={handleSubmitOfficePayment}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3
                  id="office-payment-modal-title"
                  className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]"
                >
                  Record Off-App Paid Settlement
                </h3>
                <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                  Manager / Owner approval record for off-app Bank-to-Bank or Cash-to-Cash payments.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setPaymentModal((prev) => ({ ...prev, open: false }))}
                className="p-1 text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label htmlFor="office-payment-salon" className="block text-xs font-semibold mb-1">
                Salon Account
              </label>
              <select
                id="office-payment-salon"
                value={paymentModal.salonId}
                onChange={(e) =>
                  setPaymentModal((prev) => ({ ...prev, salonId: e.target.value }))
                }
                className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              >
                {data.salons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Due: PKR {s.outstanding_balance.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-semibold mb-1">Off-App Settlement Method</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPaymentModal((prev) => ({ ...prev, method: "bank_transfer" }))
                  }
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    paymentModal.method === "bank_transfer"
                      ? "border-[#7a2e4a] bg-[#7a2e4a]/10 text-[#7a2e4a] dark:text-[#d77a9c]"
                      : "border-[#e6dfdb] dark:border-[#3a3330]"
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Bank-to-Bank</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentModal((prev) => ({ ...prev, method: "cash" }))}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    paymentModal.method === "cash"
                      ? "border-[#7a2e4a] bg-[#7a2e4a]/10 text-[#7a2e4a] dark:text-[#d77a9c]"
                      : "border-[#e6dfdb] dark:border-[#3a3330]"
                  }`}
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>Cash-to-Cash</span>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="office-payment-amount" className="block text-xs font-semibold mb-1">
                Verified Paid Amount (PKR)
              </label>
              <input
                id="office-payment-amount"
                type="number"
                min={1}
                required
                placeholder="e.g. 15000"
                value={paymentModal.amountPkr}
                onChange={(e) =>
                  setPaymentModal((prev) => ({ ...prev, amountPkr: e.target.value }))
                }
                className="w-full p-2.5 text-sm font-bold tabular-nums rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            {paymentModal.method === "bank_transfer" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="office-bank-name" className="block text-xs font-semibold mb-1">
                    Bank Name
                  </label>
                  <input
                    id="office-bank-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={60}
                    placeholder="e.g. Meezan Bank"
                    value={paymentModal.bankName}
                    onChange={(e) =>
                      setPaymentModal((prev) => ({ ...prev, bankName: e.target.value }))
                    }
                    className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
                <div>
                  <label htmlFor="office-bank-ref" className="block text-xs font-semibold mb-1">
                    IBFT / Reference #
                  </label>
                  <input
                    id="office-bank-ref"
                    type="text"
                    required
                    minLength={3}
                    maxLength={60}
                    placeholder="e.g. IBFT-884201"
                    value={paymentModal.bankReference}
                    onChange={(e) =>
                      setPaymentModal((prev) => ({ ...prev, bankReference: e.target.value }))
                    }
                    className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
              </div>
            )}

            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-900 dark:text-amber-200">
              No payment is processed through this app. This logs a verified Bank-to-Bank or Cash-to-Cash settlement as paid in the immutable ledger.
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPaymentModal((prev) => ({ ...prev, open: false }))}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingPayment}
                className="flex-1 py-2.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50"
              >
                {submittingPayment ? "Recording..." : "Mark Settlement Paid"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Audit Payment Reversal Modal (Manager / Owner) */}
      {reverseModalPayment && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reverse-payment-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <form
            onSubmit={handleConfirmReversePayment}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3"
          >
            <h3
              id="reverse-payment-modal-title"
              className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]"
            >
              Audit Reversal: {reverseModalPayment.receiptNumber || reverseModalPayment.id}
            </h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              Reverse{" "}
              <strong>PKR {reverseModalPayment.amount.toLocaleString()}</strong> for{" "}
              <strong>{reverseModalPayment.salonName || reverseModalPayment.salonId}</strong>.
            </p>
            <div>
              <label htmlFor="reverse-reason" className="block text-xs font-semibold mb-1">
                Audit Reason (5–300 characters):
              </label>
              <textarea
                id="reverse-reason"
                rows={3}
                required
                minLength={5}
                maxLength={300}
                placeholder="e.g. Duplicate bank reference entered or cheque bounced"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <p className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
              Appends an audit reversal record and restores the salon&apos;s outstanding receivable balance.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReverseModalPayment(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingReversal || reverseReason.trim().length < 5}
                className="flex-1 py-2.5 rounded-xl bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 disabled:opacity-50"
              >
                {submittingReversal ? "Reversing..." : "Confirm Audit Reversal"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
