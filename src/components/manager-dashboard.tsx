import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Coins,
  FileSpreadsheet,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
import { fetchManagerOverview, submitManagerApproval } from "../lib/api";
import { when } from "../lib/time";
import type { ManagerApprovalAction, ManagerOverviewPayload } from "../server/types";
import { SalonBulkImportModal } from "./salon-bulk-import-modal";

interface ManagerDashboardProps {
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
  onApprovedChange?: () => void;
}

type ManagerSection = "approvals" | "collections" | "orders" | "inventory";

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({
  showToast,
  onApprovedChange,
}) => {
  const [section, setSection] = useState<ManagerSection>("approvals");
  const [data, setData] = useState<ManagerOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [salonQuery, setSalonQuery] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);

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
    setBusyId(action.id);
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
  const filteredSalons = data.salons.filter(
    (s) =>
      s.name.toLowerCase().includes(salonQuery.toLowerCase()) ||
      s.area.toLowerCase().includes(salonQuery.toLowerCase()),
  );

  // Aggregate lost demand by SKU name
  const demandSummary = Object.entries(
    data.lostDemand.reduce<Record<string, number>>((acc, item) => {
      acc[item.skuName] = (acc[item.skuName] ?? 0) + item.qty;
      return acc;
    }, {}),
  );

  return (
    <div className="space-y-5">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg text-[#1d1a19] dark:text-[#f2eeec]">
            Office Manager Operations
          </h2>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
            Approvals, Karachi salon receivables, khsalon.com orders & stock variance
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBulkImport(true)}
            className="px-3.5 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs hover:bg-[#66243d]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Import Salons (Excel)</span>
          </button>

          <button
            type="button"
            onClick={() => void load()}
            className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh Ledger</span>
          </button>
        </div>
      </div>

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

        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Monthly Cash Collected</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
            PKR {data.stats.cashCollectedPkr.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
            {data.recentPayments.length} recorded cash receipts
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
        {(
          [
            { id: "approvals", label: `Approvals (${pendingApprovalCount})`, icon: ClipboardCheck },
            { id: "collections", label: "Collections & Salons", icon: Coins },
            { id: "orders", label: `Shop & Deliveries (${data.shopOrders.length})`, icon: ShoppingBag },
            { id: "inventory", label: "Stock & Demand", icon: Package },
          ] as const
        ).map((tab) => {
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
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Package className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Order Intake Cards</span>
              </h3>
              <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                {data.pendingOrderCards.length} pending
              </span>
            </div>

            {data.pendingOrderCards.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No pending order intake cards awaiting dispatch conversion.
              </div>
            ) : (
              <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                {data.pendingOrderCards.map((card) => (
                  <div key={card.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm">{card.salonName}</div>
                        <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                          {card.qty}x {card.skuName} · {when(card.capturedAt)}
                        </div>
                      </div>
                      <span className="font-bold text-xs text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums shrink-0">
                        PKR {card.totalAmount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === card.id}
                        onClick={() => runAction({ action: "approve_order_card", id: card.id })}
                        className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Convert to Delivery</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === card.id}
                        onClick={() => runAction({ action: "reject_order_card", id: card.id })}
                        className="px-3 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium text-rose-600 flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Decline</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rep Shift Bag Variance */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Rep Shift Check-In & Bag Stock Variance</span>
              </h3>
              <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                {data.shifts.length} recorded shifts
              </span>
            </div>

            {data.shifts.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No rep shift check-ins recorded yet. Check in from the Today tab to generate a shift audit row.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                      <th className="py-2 pr-3 font-semibold">Rep</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                      <th className="py-2 px-3 font-semibold text-right">Opening</th>
                      <th className="py-2 px-3 font-semibold text-right">Expected</th>
                      <th className="py-2 px-3 font-semibold text-right">Closing</th>
                      <th className="py-2 px-3 font-semibold text-right">Variance</th>
                      <th className="py-2 pl-3 font-semibold text-right">Approval</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                    {data.shifts.map((shift) => (
                      <tr key={shift.id}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold">{shift.repName}</div>
                          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                            {when(shift.openedAt)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 capitalize">{shift.status}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{shift.openingBagCount}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {shift.expectedBagCount ?? "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {shift.closingBagCount ?? "—"}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-bold tabular-nums ${
                            shift.varianceUnits === 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {shift.varianceUnits > 0 ? `+${shift.varianceUnits}` : shift.varianceUnits}
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

      {/* ================= SECTION 2: COLLECTIONS & SALONS ================= */}
      {section === "collections" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm">Salon Credit & Receivables</h3>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-52">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#6b625e]" />
                  <input
                    type="text"
                    placeholder="Filter salons..."
                    value={salonQuery}
                    onChange={(e) => setSalonQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowBulkImport(true)}
                  className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-black/5 dark:bg-white/5 text-xs font-semibold hover:border-[#7a2e4a] flex items-center gap-1 shrink-0"
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
                    <th className="py-2 pl-3 font-semibold text-right">Credit Limit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                  {filteredSalons.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">{s.area}</div>
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
                      <td className="py-2.5 pl-3 text-right tabular-nums text-[#6b625e] dark:text-[#a59b96]">
                        PKR {s.credit_limit.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-sm">Recent Cash Receipts</h3>
            {data.recentPayments.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No cash payments recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs">
                {data.recentPayments.map((pay) => (
                  <div key={pay.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{pay.salonName || pay.salonId}</div>
                      <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                        {when(pay.capturedAt)} · {pay.method}
                      </div>
                    </div>
                    <div className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                      +PKR {pay.amount.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= SECTION 3: SHOP & DELIVERIES ================= */}
      {section === "orders" && (
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
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Salon Delivery Ledger</h3>
              <span className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                {data.deliveryOrders.length} deliveries
              </span>
            </div>

            <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs">
              {data.deliveryOrders.map((ord) => (
                <div key={ord.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                      {ord.order_number}
                    </div>
                    <div className="font-bold text-sm">{ord.salon_name}</div>
                    <div className="text-[#6b625e] dark:text-[#a59b96]">
                      {ord.items.map((i) => `${i.qty}x ${i.sku_name}`).join(", ")}
                    </div>
                    {ord.delivered_at && (
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                        Delivered {when(ord.delivered_at)}
                        {ord.signature_data ? " · Digital signature attached" : ""}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold tabular-nums">PKR {ord.total_amount.toLocaleString()}</div>
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
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= SECTION 4: STOCK & DEMAND ================= */}
      {section === "inventory" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-sm">Rep Bag SKU Inventory</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                    <th className="py-2 pr-3 font-semibold">SKU</th>
                    <th className="py-2 px-3 font-semibold">Category</th>
                    <th className="py-2 px-3 font-semibold text-right">Price</th>
                    <th className="py-2 pl-3 font-semibold text-right">Bag Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                  {data.skus.map((sku) => (
                    <tr key={sku.id}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold">{sku.name}</div>
                        <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {sku.sku_code}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">{sku.category}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        PKR {sku.price.toLocaleString()}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-bold tabular-nums">
                        {sku.bag_qty} {sku.unit}s
                      </td>
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
    </div>
  );
};
