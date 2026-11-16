import React, { useCallback, useEffect, useState } from "react";
import {
  confirmRepStockIssue,
  fetchRepBagStock,
  fetchRepCommission,
  fetchRepPendingIssues,
} from "../lib/api";
import { submit } from "../lib/outbox";
import type {
  CommissionStatement,
  RepBagItem,
  RepPendingStockIssue,
  SKU,
} from "../server/types";
import {
  AlertTriangle,
  Briefcase,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Package,
  RefreshCw,
  X,
} from "lucide-react";

interface RepOperationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  skus: SKU[];
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
}

type RepTab = "bag" | "issues" | "commission";

export const RepOperationsDrawer: React.FC<RepOperationsDrawerProps> = ({
  isOpen,
  onClose,
  skus,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<RepTab>("bag");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bag stock & spot check
  const [bagItems, setBagItems] = useState<RepBagItem[]>([]);
  const [spotCounts, setSpotCounts] = useState<Record<string, number>>({});
  const [recordingSpotCheck, setRecordingSpotCheck] = useState(false);

  // Pending stock issues (blind count)
  const [pendingIssues, setPendingIssues] = useState<RepPendingStockIssue[]>([]);
  const [issueCounts, setIssueCounts] = useState<Record<string, Record<string, number>>>({});
  const [confirmingIssueId, setConfirmingIssueId] = useState<string | null>(null);

  // Commission statement
  const [commissionStatement, setCommissionStatement] = useState<CommissionStatement | null>(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const loadBagStock = useCallback(async () => {
    try {
      const items = await fetchRepBagStock();
      setBagItems(items);
      const initialCounts: Record<string, number> = {};
      items.forEach((it) => {
        initialCounts[it.skuId] = it.onHand;
      });
      setSpotCounts(initialCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bag stock.");
    }
  }, []);

  const loadPendingIssues = useCallback(async () => {
    try {
      const issues = await fetchRepPendingIssues();
      setPendingIssues(issues);
      const counts: Record<string, Record<string, number>> = {};
      issues.forEach((iss) => {
        counts[iss.id] = {};
        iss.skus.forEach((sku) => {
          counts[iss.id]![sku.skuId] = 0;
        });
      });
      setIssueCounts(counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending issues.");
    }
  }, []);

  const loadCommission = useCallback(async () => {
    try {
      const stmt = await fetchRepCommission(dateFrom, dateTo);
      setCommissionStatement(stmt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load commission.");
    }
  }, [dateFrom, dateTo]);

  const loadTabData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "bag") {
        await loadBagStock();
      } else if (activeTab === "issues") {
        await loadPendingIssues();
      } else if (activeTab === "commission") {
        await loadCommission();
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, loadBagStock, loadPendingIssues, loadCommission]);

  useEffect(() => {
    if (isOpen) {
      void loadTabData();
    }
  }, [isOpen, loadTabData]);

  if (!isOpen) return null;

  const handleRecordSpotCheck = async () => {
    setRecordingSpotCheck(true);
    try {
      const id = `spt-${Date.now()}`;
      const counted = Object.entries(spotCounts).map(([sku_id, qty]) => ({
        sku_id,
        qty: Number(qty) || 0,
      }));

      await submit({
        id,
        fn: "record_count",
        args: {
          p_id: id,
          p_kind: "spot_check",
          p_counted: counted,
          p_at_client: new Date().toISOString(),
        },
        label: "Bag Spot Count Check",
        salonId: null,
        capturedAt: new Date().toISOString(),
      });

      showToast("Spot check recorded into outbox.", "ok");
      await loadBagStock();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not record spot check.", "warn");
    } finally {
      setRecordingSpotCheck(false);
    }
  };

  const handleConfirmIssue = async (issueId: string) => {
    const countsForIssue = issueCounts[issueId] ?? {};
    const counted = Object.entries(countsForIssue).map(([sku_id, qty]) => ({
      sku_id,
      qty: Number(qty) || 0,
    }));

    setConfirmingIssueId(issueId);
    try {
      await confirmRepStockIssue(issueId, counted);
      showToast("Stock issue physical count confirmed and reconciled.", "ok");
      await loadPendingIssues();
      await loadBagStock();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not confirm stock issue.", "warn");
    } finally {
      setConfirmingIssueId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Field Rep Operations"
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 p-0 sm:p-4 backdrop-blur-xs"
    >
      <div className="w-full sm:max-w-xl h-full sm:h-[92vh] sm:rounded-2xl bg-white dark:bg-[#211d1b] border-l sm:border border-[#e6dfdb] dark:border-[#3a3330] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#e6dfdb] dark:border-[#3a3330] flex items-center justify-between gap-3 bg-[#faf7f5] dark:bg-[#171413]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#7a2e4a] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                Field Rep Operations
              </h2>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Bag Stock, Blind Counts & Commission Ledger
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadTabData}
              disabled={loading}
              className="p-2 rounded-xl text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-[#f2eeec] border border-[#e6dfdb] dark:border-[#3a3330] disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-[#f2eeec] border border-[#e6dfdb] dark:border-[#3a3330]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1 p-2 border-b border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b] text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("bag")}
            className={`flex-1 py-2 px-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "bag"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>My Bag Stock ({bagItems.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("issues")}
            className={`flex-1 py-2 px-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "issues"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Blind Counts ({pendingIssues.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("commission")}
            className={`flex-1 py-2 px-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "commission"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>My Commission</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ================= TAB 1: BAG STOCK & SPOT CHECK ================= */}
          {activeTab === "bag" && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] text-xs space-y-1">
                <span className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">
                  Field Representative Hand Inventory
                </span>
                <p className="text-[#6b625e] dark:text-[#a59b96]">
                  Goods currently in your field delivery bag. Perform regular spot checks to verify
                  inventory against system records.
                </p>
              </div>

              {bagItems.length === 0 ? (
                <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                  No items currently allocated to your bag. Stock issues from the warehouse will
                  appear in "Blind Counts".
                </div>
              ) : (
                <div className="space-y-2">
                  {bagItems.map((item) => (
                    <div
                      key={item.skuId}
                      className="p-3 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec] truncate">
                          {item.variant}
                        </div>
                        <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {item.code}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-[10px] text-[#6b625e] dark:text-[#a59b96] block">
                            System
                          </span>
                          <span className="font-bold tabular-nums text-sm">{item.onHand}</span>
                        </div>

                        <div className="w-20">
                          <label htmlFor={`spot-${item.skuId}`} className="sr-only">
                            Counted quantity
                          </label>
                          <input
                            id={`spot-${item.skuId}`}
                            type="number"
                            min={0}
                            value={spotCounts[item.skuId] ?? item.onHand}
                            onChange={(e) =>
                              setSpotCounts((prev) => ({
                                ...prev,
                                [item.skuId]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-full p-1.5 text-center font-bold tabular-nums rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleRecordSpotCheck}
                      disabled={recordingSpotCheck}
                      className="w-full py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{recordingSpotCheck ? "Recording..." : "Record Spot Check"}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 2: BLIND STOCK ISSUE CONFIRMATION ================= */}
          {activeTab === "issues" && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs space-y-1 text-amber-900 dark:text-amber-200">
                <span className="font-semibold">Blind Count Security Protocol</span>
                <p>
                  To prevent inventory discrepancies, expected quantities are concealed. Physically
                  count the units received or returned and enter your count before confirming.
                </p>
              </div>

              {pendingIssues.length === 0 ? (
                <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                  No pending stock issues awaiting your count confirmation.
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-xs">
                            Issue #{issue.id.slice(0, 8)}
                          </span>
                          <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96] block">
                            {issue.direction === "to_rep" ? "Warehouse → Rep Bag" : "Rep Bag → Warehouse"}
                          </span>
                        </div>
                        <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {new Date(issue.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      {issue.decisionNote && (
                        <p className="text-xs text-[#6b625e] dark:text-[#a59b96] italic">
                          "{issue.decisionNote}"
                        </p>
                      )}

                      <div className="space-y-2 pt-1 border-t border-[#e6dfdb]/60 dark:border-[#3a3330]">
                        {issue.skus.map((sku) => {
                          const currentVal = issueCounts[issue.id]?.[sku.skuId] ?? 0;
                          return (
                            <div
                              key={sku.skuId}
                              className="flex items-center justify-between gap-3 text-xs p-2 rounded-xl bg-[#faf7f5] dark:bg-[#171413]"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold truncate">{sku.variant}</div>
                                <div className="font-mono text-[10px] text-[#6b625e] dark:text-[#a59b96]">
                                  {sku.code}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                  Physical Count:
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  value={currentVal}
                                  onChange={(e) => {
                                    const next = Math.max(0, Number(e.target.value) || 0);
                                    setIssueCounts((prev) => ({
                                      ...prev,
                                      [issue.id]: {
                                        ...(prev[issue.id] ?? {}),
                                        [sku.skuId]: next,
                                      },
                                    }));
                                  }}
                                  className="w-16 p-1.5 text-center font-bold tabular-nums rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConfirmIssue(issue.id)}
                        disabled={confirmingIssueId === issue.id}
                        className="w-full py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {confirmingIssueId === issue.id
                            ? "Reconciling..."
                            : "Confirm Physical Count"}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 3: COMMISSION LEDGER ================= */}
          {activeTab === "commission" && (
            <div className="space-y-4">
              {/* Date Filter */}
              <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <label htmlFor="comm-from" className="font-semibold text-[#6b625e]">
                    From:
                  </label>
                  <input
                    id="comm-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="p-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                  />
                  <label htmlFor="comm-to" className="font-semibold text-[#6b625e]">
                    To:
                  </label>
                  <input
                    id="comm-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="p-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                  />
                </div>

                <button
                  type="button"
                  onClick={loadCommission}
                  className="px-3 py-1 bg-[#7a2e4a] text-white rounded-lg font-semibold"
                >
                  Apply
                </button>
              </div>

              {commissionStatement && (
                <div className="space-y-4">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-3 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
                      <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Earned</span>
                      <div className="text-sm font-extrabold tabular-nums mt-0.5 text-[#1d1a19] dark:text-[#f2eeec]">
                        PKR {(commissionStatement.earnedPaisa / 100).toLocaleString()}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
                      <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Paid</span>
                      <div className="text-sm font-extrabold tabular-nums mt-0.5 text-emerald-700 dark:text-emerald-400">
                        PKR {(commissionStatement.paidPaisa / 100).toLocaleString()}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
                      <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Owed</span>
                      <div className="text-sm font-extrabold tabular-nums mt-0.5 text-[#7a2e4a] dark:text-[#d77a9c]">
                        PKR {(commissionStatement.owedPaisa / 100).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Delivered Invoices with Commission */}
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-2 text-xs">
                    <h3 className="font-bold text-xs">
                      Delivered Invoices ({commissionStatement.invoices.length})
                    </h3>
                    {commissionStatement.invoices.length === 0 ? (
                      <p className="text-[11px] text-[#6b625e]">No qualifying invoices in range.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {commissionStatement.invoices.map((inv) => (
                          <div
                            key={inv.invoiceId}
                            className="p-2 rounded-lg bg-[#faf7f5] dark:bg-[#171413] flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{inv.salonName}</div>
                              <div className="font-mono text-[10px] text-[#6b625e]">
                                {inv.number} · {inv.rateBp / 100}%
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                                PKR {(inv.commissionPaisa / 100).toLocaleString()}
                              </div>
                              <div className="text-[10px] text-[#6b625e] tabular-nums">
                                Invoiced: PKR {(inv.totalPaisa / 100).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Payments Received */}
                  {commissionStatement.payments.length > 0 && (
                    <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-2 text-xs">
                      <h3 className="font-bold text-xs">Disbursed Commission Payments</h3>
                      <div className="space-y-1.5">
                        {commissionStatement.payments.map((p) => (
                          <div
                            key={p.paymentId}
                            className="p-2 rounded-lg bg-[#faf7f5] dark:bg-[#171413] flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="font-semibold">
                                {p.kind === "payment" ? "Disbursed by Office" : "Reversed"}
                              </div>
                              <div className="text-[10px] text-[#6b625e]">
                                {new Date(p.recordedAt).toLocaleDateString()} by {p.recordedByName}
                              </div>
                            </div>
                            <div className="font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              PKR {(p.amountPaisa / 100).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
