import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  PackageCheck,
  PhoneCall,
  Plus,
  Search,
  Sparkles,
  User,
  X,
} from "lucide-react";
import type { DeliveryOrderFull, SalonWithApproval, UserRole } from "../server/types";
import type { SKU } from "../lib/data";
import {
  computeSalonStockForecasts,
  filterSalonStockForecasts,
  type RestockAlertLevel,
  type SalonStockForecast,
  type SkuStockEstimate,
} from "../lib/salon-stock-forecast";

interface SalonRestockAlertsProps {
  salons: SalonWithApproval[];
  deliveries: DeliveryOrderFull[];
  skus: SKU[];
  onDraftRestockCard?: (card: {
    salonId: string;
    salonName: string;
    skuId: string;
    skuName: string;
    qty: number;
    unitPrice: number;
    notes?: string;
  }) => Promise<void>;
  onCreateOfficialOrder?: (order: {
    salonId: string;
    plan: "CASH" | "INST2" | "INST4";
    lines: Array<{ sku_id: string; qty: number }>;
  }) => Promise<void>;
  userRole?: UserRole;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
}

export const SalonRestockAlerts: React.FC<SalonRestockAlertsProps> = ({
  salons,
  deliveries,
  skus,
  onDraftRestockCard,
  onCreateOfficialOrder,
  userRole = "manager",
  showToast,
}) => {
  const [alertFilter, setAlertFilter] = useState<"all" | RestockAlertLevel>("all");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"urgency" | "name" | "stock_low_first" | "cadence">("urgency");
  const [draftModalData, setDraftModalData] = useState<{
    open: boolean;
    mode: "card" | "official_order";
    forecast: SalonStockForecast | null;
    selectedSkuId: string;
    qty: number;
    plan: "CASH" | "INST2" | "INST4";
    customerConfirmed: boolean;
    notes: string;
  }>({
    open: false,
    mode: "card",
    forecast: null,
    selectedSkuId: "",
    qty: 6,
    plan: "CASH",
    customerConfirmed: false,
    notes: "",
  });
  const [submittingDraft, setSubmittingDraft] = useState(false);

  // Compute all salon stock forecasts
  const allForecasts = useMemo(() => {
    return computeSalonStockForecasts(salons, deliveries, skus);
  }, [salons, deliveries, skus]);

  // Compute unique areas for filter dropdown
  const areas = useMemo(() => {
    const set = new Set<string>();
    for (const s of salons) {
      if (s.area) set.add(s.area);
    }
    return Array.from(set).sort();
  }, [salons]);

  // Filtered and sorted forecasts
  const filteredForecasts = useMemo(() => {
    return filterSalonStockForecasts(allForecasts, {
      alertLevel: alertFilter,
      query: searchQuery,
      area: areaFilter,
      sortBy,
    });
  }, [allForecasts, alertFilter, searchQuery, areaFilter, sortBy]);

  // Top metric counters
  const metrics = useMemo(() => {
    let criticalCount = 0;
    let warningCount = 0;
    let healthyCount = 0;
    let totalStockValue = 0;

    for (const f of allForecasts) {
      if (f.restockAlertLevel === "critical") criticalCount++;
      else if (f.restockAlertLevel === "warning") warningCount++;
      else healthyCount++;
      totalStockValue += f.totalStockValuePkr;
    }

    return {
      criticalCount,
      warningCount,
      healthyCount,
      totalStockValue,
    };
  }, [allForecasts]);

  const isOffice = userRole === "manager" || userRole === "owner";

  const openDraftOrderModal = (
    forecast: SalonStockForecast,
    targetSku?: SkuStockEstimate,
    mode: "card" | "official_order" = isOffice && onCreateOfficialOrder ? "official_order" : "card",
  ) => {
    const defaultSku = targetSku
      ? targetSku.skuId
      : forecast.suggestedReorderSkus[0]?.skuId || forecast.skuBreakdown[0]?.skuId || skus[0]?.id || "";
    const defaultQty = targetSku
      ? Math.max(4, targetSku.lastDeliveredQty)
      : forecast.suggestedReorderSkus[0]?.suggestedQty || 6;

    setDraftModalData({
      open: true,
      mode,
      forecast,
      selectedSkuId: defaultSku,
      qty: defaultQty,
      plan: "CASH",
      customerConfirmed: false,
      notes: `Advisory restock follow-up based on ${forecast.orderFrequencyDays}-day delivery cadence.`,
    });
  };

  const handleConfirmDraftOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftModalData.forecast) return;
    const { forecast, selectedSkuId, qty, notes, mode, plan, customerConfirmed } = draftModalData;
    const fallbackSku = skus.find((s) => s.id === selectedSkuId);
    const breakdownSku = forecast.skuBreakdown.find((s) => s.skuId === selectedSkuId);
    const resolvedSkuName = breakdownSku?.skuName || fallbackSku?.name || "";
    const resolvedPrice = breakdownSku?.unitPricePkr || fallbackSku?.price || 0;

    if (!selectedSkuId || !resolvedSkuName) {
      showToast("Select a valid SKU from the catalog.", "warn");
      return;
    }
    if (qty <= 0) {
      showToast("Quantity must be greater than zero.", "warn");
      return;
    }

    setSubmittingDraft(true);
    try {
      if (mode === "official_order") {
        if (!customerConfirmed) {
          showToast("Confirm customer approval before creating an official sales order.", "warn");
          setSubmittingDraft(false);
          return;
        }
        if (onCreateOfficialOrder) {
          await onCreateOfficialOrder({
            salonId: forecast.salonId,
            plan,
            lines: [{ sku_id: selectedSkuId, qty }],
          });
          setDraftModalData((prev) => ({ ...prev, open: false }));
          showToast(`Official sales order created for ${forecast.salonName} (${qty}x ${resolvedSkuName}).`, "ok");
        }
      } else {
        if (onDraftRestockCard) {
          await onDraftRestockCard({
            salonId: forecast.salonId,
            salonName: forecast.salonName,
            skuId: selectedSkuId,
            skuName: resolvedSkuName,
            qty,
            unitPrice: resolvedPrice,
            notes,
          });
        }
        setDraftModalData((prev) => ({ ...prev, open: false }));
        showToast(
          `Restock order request for ${forecast.salonName} (${qty}x ${resolvedSkuName}) submitted for Office review.`,
          "ok",
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to submit restock action.", "warn");
    } finally {
      setSubmittingDraft(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg text-[#1d1a19] dark:text-[#f2eeec]">
            Client Salon Stock &amp; Proactive Restock Alerts
          </h2>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
            Proactive restocking intelligence based on historical order frequency, salon chair scale, and estimated inventory
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] px-3 py-1.5 rounded-xl">
            <span>{salons.length} client salons tracked</span>
          </div>
        </div>
      </div>

      {/* Urgent Alert Banner (if any critical salons exist) */}
      {metrics.criticalCount > 0 && (
        <section
          aria-label="Critical Restock Notice"
          className="p-4 rounded-2xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 shadow-xs flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 shrink-0">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-amber-900 dark:text-amber-200">
                {metrics.criticalCount} {metrics.criticalCount === 1 ? "Salon" : "Salons"} Near Depletion — Immediate Call Recommended
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-0.5">
                Stylist inventory has dropped to ≤ 3 days remaining based on order cadence. Proactive follow-up prevents salon stockout and lost treatment revenue.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setAlertFilter("critical");
              setAreaFilter("all");
            }}
            className="px-3.5 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
          >
            Filter {metrics.criticalCount} Critical
          </button>
        </section>
      )}

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          onClick={() => setAlertFilter(alertFilter === "critical" ? "all" : "critical")}
          className={`p-4 rounded-2xl bg-white dark:bg-[#211d1b] border cursor-pointer transition-all ${
            alertFilter === "critical"
              ? "border-red-500 ring-2 ring-red-500/20"
              : "border-[#e6dfdb] dark:border-[#3a3330] hover:border-red-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#6b625e] dark:text-[#a59b96]">
            <span>Critical Restock Needed</span>
            <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-red-700 dark:text-red-400">
            {metrics.criticalCount}
          </div>
          <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
            Depletion in ≤ 3 days · call stylist now
          </div>
        </div>

        <div
          onClick={() => setAlertFilter(alertFilter === "warning" ? "all" : "warning")}
          className={`p-4 rounded-2xl bg-white dark:bg-[#211d1b] border cursor-pointer transition-all ${
            alertFilter === "warning"
              ? "border-amber-500 ring-2 ring-amber-500/20"
              : "border-[#e6dfdb] dark:border-[#3a3330] hover:border-amber-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#6b625e] dark:text-[#a59b96]">
            <span>Due Soon (4–7 Days)</span>
            <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-amber-700 dark:text-amber-300">
            {metrics.warningCount}
          </div>
          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
            Schedule routine follow-up call
          </div>
        </div>

        <div
          onClick={() => setAlertFilter(alertFilter === "healthy" ? "all" : "healthy")}
          className={`p-4 rounded-2xl bg-white dark:bg-[#211d1b] border cursor-pointer transition-all ${
            alertFilter === "healthy"
              ? "border-emerald-500 ring-2 ring-emerald-500/20"
              : "border-[#e6dfdb] dark:border-[#3a3330] hover:border-emerald-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#6b625e] dark:text-[#a59b96]">
            <span>Healthy Stock Level</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
            {metrics.healthyCount}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
            &gt; 7 days of estimated inventory
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="flex items-center justify-between text-xs text-[#6b625e] dark:text-[#a59b96]">
            <span>Est. Salon Stock Value</span>
            <PackageCheck className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
          </div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[#1d1a19] dark:text-[#f2eeec]">
            PKR {metrics.totalStockValue.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
            In-salon stock across Karachi
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#6b625e] dark:text-[#a59b96]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search salon, stylist, phone, or SKU..."
            className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs text-[#1d1a19] dark:text-[#f2eeec] placeholder-[#6b625e] focus:outline-hidden focus:border-[#7a2e4a]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6b625e] hover:text-[#1d1a19] p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Urgency segmented buttons */}
        <div className="flex items-center gap-1 bg-[#faf7f5] dark:bg-[#171413] p-1 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330]">
          {(
            [
              { id: "all", label: "All Alerts" },
              { id: "critical", label: "Critical" },
              { id: "warning", label: "Due Soon" },
              { id: "healthy", label: "Healthy" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setAlertFilter(tab.id)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
                alertFilter === tab.id
                  ? "bg-white dark:bg-[#211d1b] text-[#7a2e4a] dark:text-[#d77a9c] shadow-xs font-semibold"
                  : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Area dropdown */}
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="px-3 py-1.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs text-[#1d1a19] dark:text-[#f2eeec] focus:outline-hidden focus:border-[#7a2e4a]"
        >
          <option value="all">All Karachi Areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-1.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs text-[#1d1a19] dark:text-[#f2eeec] focus:outline-hidden focus:border-[#7a2e4a]"
        >
          <option value="urgency">Sort: Most Urgent First</option>
          <option value="stock_low_first">Sort: Lowest Stock Units</option>
          <option value="cadence">Sort: Order Frequency (Fastest)</option>
          <option value="name">Sort: Salon Name (A-Z)</option>
        </select>
      </div>

      {/* List of Salon Stock Cards */}
      <div className="space-y-4">
        {filteredForecasts.length === 0 ? (
          <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96] text-xs">
            No salons matched the active filter or search query.
          </div>
        ) : (
          filteredForecasts.map((f) => {
            const isCritical = f.restockAlertLevel === "critical";
            const isWarning = f.restockAlertLevel === "warning";
            const stageLabel = f.stage.toUpperCase();

            return (
              <div
                key={f.salonId}
                className={`rounded-2xl bg-white dark:bg-[#211d1b] border transition-all p-4 space-y-3.5 shadow-xs ${
                  isCritical
                    ? "border-red-300 dark:border-red-900/60"
                    : isWarning
                      ? "border-amber-300 dark:border-amber-900/60"
                      : "border-[#e6dfdb] dark:border-[#3a3330]"
                }`}
              >
                {/* Header Row: Salon details + Primary action buttons */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e6dfdb] dark:border-[#3a3330] pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                        {f.salonName}
                      </h3>
                      {/* Zero-pill: clean text metadata */}
                      <span className="text-[11px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                        [{stageLabel}]
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b625e] dark:text-[#a59b96]">
                      <span>{f.area}</span>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-1 text-[#1d1a19] dark:text-[#f2eeec]">
                        <User className="w-3 h-3 text-[#6b625e]" />
                        {f.contactPerson || "Lead Stylist"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{f.phone}</span>
                    </div>
                  </div>

                  {/* Actions: Call Salon + Draft Restock Card */}
                  <div className="flex items-center gap-2">
                    <a
                      href={`tel:${f.phone.replace(/[^0-9+]/g, "")}`}
                      title={`Call ${f.contactPerson} at ${f.phone}`}
                      className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors shadow-xs"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>Call {f.contactPerson ? f.contactPerson.split(" ")[0] : "Salon"}</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => openDraftOrderModal(f)}
                      className="px-3 py-1.5 rounded-xl bg-[#7a2e4a] hover:bg-[#66243d] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isOffice && onCreateOfficialOrder ? "Create Order (Confirmed)" : "Draft Request Card"}</span>
                    </button>
                  </div>
                </div>

                {/* Cadence & Depletion Telemetry Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs">
                  <div>
                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Order Cadence</div>
                    <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec] mt-0.5 tabular-nums">
                      Every {f.orderFrequencyDays} days
                    </div>
                    <div className="text-[10px] text-[#6b625e] dark:text-[#a59b96]">
                      {f.totalOrdersDelivered} past deliveries
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Last Restocked</div>
                    <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec] mt-0.5 tabular-nums">
                      {f.daysSinceLastDelivery} days ago
                    </div>
                    <div className="text-[10px] text-[#6b625e] dark:text-[#a59b96]">
                      {f.lastDeliveredUnits} units delivered
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Est. Stock on Hand</div>
                    <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec] mt-0.5 tabular-nums">
                      {f.totalEstimatedStockOnHand} units
                    </div>
                    <div className="text-[10px] text-[#6b625e] dark:text-[#a59b96]">
                      PKR {f.totalStockValuePkr.toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Run-out Forecast</div>
                    <div
                      className={`font-bold mt-0.5 tabular-nums ${
                        isCritical
                          ? "text-red-700 dark:text-red-400"
                          : isWarning
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {f.estimatedDepletionDays <= 0
                        ? "Depleted / Overdue"
                        : `~${f.estimatedDepletionDays} days remaining`}
                    </div>
                    <div className="text-[10px] text-[#6b625e] dark:text-[#a59b96]">
                      {isCritical ? "Immediate Call" : isWarning ? "Follow-Up Window" : "Healthy Stock"}
                    </div>
                  </div>
                </div>

                {/* SKU Breakdown Table (actual delivered history only) */}
                {!f.hasHistoricalDeliveries ? (
                  <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs text-[#6b625e] dark:text-[#a59b96]">
                    No completed deliveries recorded yet for this salon. Estimated depletion starts automatically after the first official delivery.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                          <th className="py-1.5 px-2 font-medium">Product / SKU</th>
                          <th className="py-1.5 px-2 font-medium">Brand</th>
                          <th className="py-1.5 px-2 font-medium text-right">Last Delivered</th>
                          <th className="py-1.5 px-2 font-medium text-right">Daily Burn</th>
                          <th className="py-1.5 px-2 font-medium text-right">Units on Hand</th>
                          <th className="py-1.5 px-2 font-medium text-right">Days Left</th>
                          <th className="py-1.5 px-2 font-medium">Status</th>
                          <th className="py-1.5 px-2 font-medium text-right">Follow-up</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e6dfdb] dark:divide-[#3a3330]">
                        {f.skuBreakdown.map((sku) => {
                          const isSkuCritical = sku.stockStatus === "critical";
                          const isSkuWarning = sku.stockStatus === "warning";

                          return (
                            <tr key={sku.skuId} className="hover:bg-[#faf7f5]/80 dark:hover:bg-[#1a1716]">
                              <td className="py-1.5 px-2 font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                                {sku.skuName}
                              </td>
                              <td className="py-1.5 px-2 text-[#6b625e] dark:text-[#a59b96]">
                                {sku.brand}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-[#6b625e] dark:text-[#a59b96]">
                                {sku.lastDeliveredQty} units
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-[#6b625e] dark:text-[#a59b96]">
                                {sku.dailyConsumptionRate}/day
                              </td>
                              <td className="py-1.5 px-2 text-right font-bold tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
                                {sku.estimatedUnitsOnHand}
                              </td>
                              <td
                                className={`py-1.5 px-2 text-right font-semibold tabular-nums ${
                                  isSkuCritical
                                    ? "text-red-700 dark:text-red-400"
                                    : isSkuWarning
                                      ? "text-amber-700 dark:text-amber-300"
                                      : "text-emerald-700 dark:text-emerald-400"
                                }`}
                              >
                                {sku.daysOfStockLeft}d
                              </td>
                              <td className="py-1.5 px-2">
                                {isSkuCritical ? (
                                  <span className="text-red-700 dark:text-red-400 font-medium">
                                    Critical (Low)
                                  </span>
                                ) : isSkuWarning ? (
                                  <span className="text-amber-700 dark:text-amber-300 font-medium">
                                    Reorder Soon
                                  </span>
                                ) : (
                                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                    Healthy
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => openDraftOrderModal(f, sku)}
                                  className="px-2 py-0.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-[11px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:border-[#7a2e4a]"
                                >
                                  + Restock
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Proactive Guidance Callout */}
                <div
                  className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                    isCritical
                      ? "bg-red-50/80 dark:bg-red-950/20 border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-300"
                      : isWarning
                        ? "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300"
                        : "bg-neutral-50 dark:bg-[#1a1716] border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
                  }`}
                >
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                  <div className="space-y-0.5">
                    <span className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">
                      Proactive Restocking Recommendation:{" "}
                    </span>
                    <span>{f.alertReason} </span>
                    <span className="font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                      {f.recommendedAction}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Advisory Restock Action Modal (Official Order w/ Customer Confirmation OR Rep Request Card) */}
      {draftModalData.open && draftModalData.forecast && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#e6dfdb] dark:border-[#3a3330] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                  {draftModalData.mode === "official_order"
                    ? "Create Official Sales Order (Customer Confirmed)"
                    : "Draft Restock Order Request Card"}
                </h3>
                <p className="text-xs text-[#6b625e] dark:text-[#a59b96] mt-0.5">
                  Advisory follow-up for {draftModalData.forecast.salonName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraftModalData((prev) => ({ ...prev, open: false }))}
                className="p-1 rounded-lg text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-[#f2eeec]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmDraftOrder} className="space-y-3.5 text-xs">
              <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] space-y-1">
                <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Client Salon</div>
                <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec] text-sm">
                  {draftModalData.forecast.salonName}
                </div>
                <div className="text-[#6b625e] dark:text-[#a59b96]">
                  {draftModalData.forecast.area} · Contact: {draftModalData.forecast.contactPerson} ({draftModalData.forecast.phone})
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#1d1a19] dark:text-[#f2eeec] mb-1">
                  Product / SKU to Restock
                </label>
                <select
                  value={draftModalData.selectedSkuId}
                  onChange={(e) =>
                    setDraftModalData((prev) => ({ ...prev, selectedSkuId: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs text-[#1d1a19] dark:text-[#f2eeec] focus:outline-hidden focus:border-[#7a2e4a]"
                >
                  {(draftModalData.forecast.skuBreakdown.length > 0
                    ? draftModalData.forecast.skuBreakdown.map((s) => ({
                        id: s.skuId,
                        label: `${s.skuName} (${s.brand}) — Est. ${s.estimatedUnitsOnHand} on hand (PKR ${s.unitPricePkr.toLocaleString()})`,
                      }))
                    : skus.map((s) => ({
                        id: s.id,
                        label: `${s.name} (${s.brand || "Catalog"}) — PKR ${s.price.toLocaleString()}`,
                      }))
                  ).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#1d1a19] dark:text-[#f2eeec] mb-1">
                    Quantity (Units)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={draftModalData.qty}
                    onChange={(e) =>
                      setDraftModalData((prev) => ({
                        ...prev,
                        qty: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-mono tabular-nums"
                  />
                </div>

                {draftModalData.mode === "official_order" && (
                  <div>
                    <label className="block font-medium text-[#1d1a19] dark:text-[#f2eeec] mb-1">
                      Payment Plan
                    </label>
                    <select
                      value={draftModalData.plan}
                      onChange={(e) =>
                        setDraftModalData((prev) => ({
                          ...prev,
                          plan: e.target.value as "CASH" | "INST2" | "INST4",
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs"
                    >
                      <option value="CASH">CASH (Full on Delivery)</option>
                      <option value="INST2">INST2 (2 Installments)</option>
                      <option value="INST4">INST4 (4 Installments)</option>
                    </select>
                  </div>
                )}
              </div>

              {draftModalData.mode === "official_order" ? (
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftModalData.customerConfirmed}
                    onChange={(e) =>
                      setDraftModalData((prev) => ({ ...prev, customerConfirmed: e.target.checked }))
                    }
                    className="mt-0.5 accent-[#7a2e4a]"
                  />
                  <span className="text-amber-900 dark:text-amber-200 leading-relaxed">
                    <strong>Customer Confirmation Required:</strong> I confirm the salon partner explicitly approved this restock quantity and pricing. Forecasts never generate official sales orders automatically.
                  </span>
                </label>
              ) : (
                <div>
                  <label className="block font-medium text-[#1d1a19] dark:text-[#f2eeec] mb-1">
                    Request Notes
                  </label>
                  <textarea
                    rows={2}
                    value={draftModalData.notes}
                    onChange={(e) =>
                      setDraftModalData((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e6dfdb] dark:border-[#3a3330]">
                <button
                  type="button"
                  onClick={() => setDraftModalData((prev) => ({ ...prev, open: false }))}
                  className="px-4 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold text-[#6b625e] dark:text-[#a59b96]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    submittingDraft ||
                    (draftModalData.mode === "official_order" && !draftModalData.customerConfirmed)
                  }
                  className="px-4 py-2 rounded-xl bg-[#7a2e4a] hover:bg-[#66243d] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {submittingDraft
                      ? "Submitting..."
                      : draftModalData.mode === "official_order"
                        ? "Create Official Order"
                        : "Submit Request Card"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
