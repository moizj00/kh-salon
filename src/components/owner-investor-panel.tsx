import React, { useCallback, useEffect, useState } from "react";
import {
  addOfficeInvestment,
  createOfficeInvestor,
  decideInvestorProfit,
  fetchInvestorInvestments,
  fetchInvestorStatement,
  fetchOfficeInvestors,
  recordInvestorPayout,
  reverseInvestorEntry,
} from "../lib/api";
import type {
  InvestorInvestmentRow,
  InvestorStatementEntry,
  InvestorSummaryRow,
} from "../server/types";
import {
  AlertCircle,
  Coins,
  DollarSign,
  History,
  Info,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";

interface OwnerInvestorPanelProps {
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
}

export const OwnerInvestorPanel: React.FC<OwnerInvestorPanelProps> = ({ showToast }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Investors state
  const [investors, setInvestors] = useState<InvestorSummaryRow[]>([]);
  const [selectedInvestorId, setSelectedInvestorId] = useState<string | null>(null);

  // Selected investor data
  const [investments, setInvestments] = useState<InvestorInvestmentRow[]>([]);
  const [statement, setStatement] = useState<InvestorStatementEntry[]>([]);

  // Sub-dialogs
  const [showNewInvestorModal, setShowNewInvestorModal] = useState(false);
  const [newInvestorName, setNewInvestorName] = useState("");
  const [newInvestorPhone, setNewInvestorPhone] = useState("");
  const [newInvestorNote, setNewInvestorNote] = useState("");

  const [showAddInvestmentModal, setShowAddInvestmentModal] = useState(false);
  const [investmentAmountPkr, setInvestmentAmountPkr] = useState<number>(0);
  const [investmentDate, setInvestmentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [investmentNote, setInvestmentNote] = useState("");

  const [showDecideProfitModal, setShowDecideProfitModal] = useState(false);
  const [targetInvestmentId, setTargetInvestmentId] = useState<string>("");
  const [profitAmountPkr, setProfitAmountPkr] = useState<number>(0);
  const [profitDate, setProfitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [profitNote, setProfitNote] = useState("");

  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutKind, setPayoutKind] = useState<"principal" | "profit">("profit");
  const [payoutMethod, setPayoutMethod] = useState<"bank" | "cash">("bank");
  const [payoutAmountPkr, setPayoutAmountPkr] = useState<number>(0);
  const [payoutDate, setPayoutDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payoutRef, setPayoutRef] = useState("");
  const [payoutNote, setPayoutNote] = useState("");

  // Reversal dialog
  const [reversingEntry, setReversingEntry] = useState<{
    id: string;
    kind: "investment" | "profit" | "payout";
  } | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  const loadInvestors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchOfficeInvestors();
      setInvestors(rows);
      if (rows.length > 0 && !selectedInvestorId) {
        const first = rows.find((r) => !r.isTotal && r.investorId);
        if (first?.investorId) {
          setSelectedInvestorId(first.investorId);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load investor records.");
    } finally {
      setLoading(false);
    }
  }, [selectedInvestorId]);

  const loadInvestorDetails = useCallback(async (investorId: string) => {
    try {
      const [invs, stmt] = await Promise.all([
        fetchInvestorInvestments(investorId),
        fetchInvestorStatement(investorId),
      ]);
      setInvestments(invs);
      setStatement(stmt);
      if (invs.length > 0 && !targetInvestmentId) {
        setTargetInvestmentId(invs[0]!.investmentId);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not load investor details.", "warn");
    }
  }, [showToast, targetInvestmentId]);

  useEffect(() => {
    void loadInvestors();
  }, [loadInvestors]);

  useEffect(() => {
    if (selectedInvestorId) {
      void loadInvestorDetails(selectedInvestorId);
    } else {
      setInvestments([]);
      setStatement([]);
    }
  }, [selectedInvestorId, loadInvestorDetails]);

  const handleCreateInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvestorName.trim()) return;
    try {
      const invId = await createOfficeInvestor({
        fullName: newInvestorName.trim(),
        phone: newInvestorPhone.trim() || undefined,
        note: newInvestorNote.trim() || undefined,
      });
      showToast(`Investor "${newInvestorName}" registered.`, "ok");
      setShowNewInvestorModal(false);
      setNewInvestorName("");
      setNewInvestorPhone("");
      setNewInvestorNote("");
      setSelectedInvestorId(invId);
      await loadInvestors();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not register investor.", "warn");
    }
  };

  const handleAddInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvestorId || investmentAmountPkr <= 0) return;
    try {
      await addOfficeInvestment({
        investorId: selectedInvestorId,
        amountPaisa: investmentAmountPkr * 100,
        investedOn: investmentDate,
        note: investmentNote.trim() || undefined,
      });
      showToast(`Capital contribution of PKR ${investmentAmountPkr.toLocaleString()} recorded.`, "ok");
      setShowAddInvestmentModal(false);
      setInvestmentAmountPkr(0);
      setInvestmentNote("");
      await loadInvestors();
      await loadInvestorDetails(selectedInvestorId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not record investment.", "warn");
    }
  };

  const handleDecideProfit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetInvestmentId || profitAmountPkr <= 0) return;
    try {
      await decideInvestorProfit({
        investmentId: targetInvestmentId,
        amountPaisa: profitAmountPkr * 100,
        decidedOn: profitDate,
        note: profitNote.trim() || undefined,
      });
      showToast(`Discretionary profit decision of PKR ${profitAmountPkr.toLocaleString()} recorded.`, "ok");
      setShowDecideProfitModal(false);
      setProfitAmountPkr(0);
      setProfitNote("");
      if (selectedInvestorId) {
        await loadInvestors();
        await loadInvestorDetails(selectedInvestorId);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not record profit decision.", "warn");
    }
  };

  const handleRecordPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvestorId || payoutAmountPkr <= 0) return;
    try {
      await recordInvestorPayout({
        investorId: selectedInvestorId,
        investmentId: targetInvestmentId || undefined,
        payoutKind,
        method: payoutMethod,
        amountPaisa: payoutAmountPkr * 100,
        paidOn: payoutDate,
        reference: payoutRef.trim() || undefined,
        note: payoutNote.trim() || undefined,
      });
      showToast(`Investor payout of PKR ${payoutAmountPkr.toLocaleString()} recorded.`, "ok");
      setShowPayoutModal(false);
      setPayoutAmountPkr(0);
      setPayoutRef("");
      setPayoutNote("");
      await loadInvestors();
      await loadInvestorDetails(selectedInvestorId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not record payout.", "warn");
    }
  };

  const handleReverseEntry = async () => {
    if (!reversingEntry || !reversalReason.trim()) return;
    try {
      await reverseInvestorEntry({
        entryId: reversingEntry.id,
        entryKind: reversingEntry.kind,
        reason: reversalReason.trim(),
      });
      showToast("Ledger entry reversed with audit log entry.", "ok");
      setReversingEntry(null);
      setReversalReason("");
      if (selectedInvestorId) {
        await loadInvestors();
        await loadInvestorDetails(selectedInvestorId);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not reverse entry.", "warn");
    }
  };

  const selectedInvestor = investors.find((i) => i.investorId === selectedInvestorId);
  const totalRow = investors.find((i) => i.isTotal);

  return (
    <div className="space-y-4">
      {/* Policy Safeguard Notice */}
      <div className="p-4 rounded-2xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-2 text-xs">
        <div className="flex items-center gap-2 font-bold text-[#7a2e4a] dark:text-[#d77a9c]">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>Manual Management Ledger — Owner Discretionary Governance</span>
        </div>
        <p className="text-[#6b625e] dark:text-[#a59b96] leading-relaxed">
          All capital contributions, profit allocations, and investor payouts are manual management
          entries entered by the Owner. By policy, the system contains{" "}
          <strong>no automatic ROI formulas, promised percentage yields, or automatic profit splits</strong>.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Portfolio Totals Banner */}
      {totalRow && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
            <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Total Capital Raised</span>
            <div className="text-base font-extrabold tabular-nums mt-0.5 text-[#1d1a19] dark:text-[#f2eeec]">
              PKR {(totalRow.investedPaisa / 100).toLocaleString()}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
            <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Principal Outstanding</span>
            <div className="text-base font-extrabold tabular-nums mt-0.5 text-[#7a2e4a] dark:text-[#d77a9c]">
              PKR {(totalRow.principalOutstandingPaisa / 100).toLocaleString()}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
            <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Profit Decided (Discretionary)</span>
            <div className="text-base font-extrabold tabular-nums mt-0.5 text-[#1d1a19] dark:text-[#f2eeec]">
              PKR {(totalRow.profitDecidedPaisa / 100).toLocaleString()}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
            <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Profit Owed / Undisbursed</span>
            <div className="text-base font-extrabold tabular-nums mt-0.5 text-amber-700 dark:text-amber-400">
              PKR {(totalRow.profitOwedPaisa / 100).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Investor Registry */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm">Investor Registry</h3>
            <button
              type="button"
              onClick={() => setShowNewInvestorModal(true)}
              className="px-3 py-1.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Investor</span>
            </button>
          </div>

          <div className="space-y-2">
            {investors
              .filter((inv) => !inv.isTotal && inv.investorId)
              .map((inv) => (
                <button
                  key={inv.investorId}
                  type="button"
                  onClick={() => setSelectedInvestorId(inv.investorId)}
                  className={`w-full text-left p-3.5 rounded-2xl border transition-colors shadow-xs ${
                    selectedInvestorId === inv.investorId
                      ? "border-[#7a2e4a] bg-[#7a2e4a]/5"
                      : "border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] truncate">
                        {inv.fullName}
                      </div>
                      {inv.phone && (
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {inv.phone}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/5 dark:bg-white/5">
                      {inv.status ?? "active"}
                    </span>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] flex items-center justify-between text-xs tabular-nums">
                    <span className="text-[#6b625e] dark:text-[#a59b96]">Invested</span>
                    <span className="font-bold text-[#1d1a19] dark:text-[#f2eeec]">
                      PKR {(inv.investedPaisa / 100).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs tabular-nums mt-0.5">
                    <span className="text-[#6b625e] dark:text-[#a59b96]">Profit Owed</span>
                    <span className="font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                      PKR {(inv.profitOwedPaisa / 100).toLocaleString()}
                    </span>
                  </div>
                </button>
              ))}
          </div>
        </div>

        {/* Right Column: Active Investor Detail & Actions */}
        <div className="lg:col-span-2 space-y-4">
          {selectedInvestor ? (
            <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6dfdb] dark:border-[#3a3330] pb-3">
                <div>
                  <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                    {selectedInvestor.fullName}
                  </h3>
                  <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                    Capital Contributions & Discretionary Profit Ledger
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowAddInvestmentModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-[#7a2e4a] text-white font-semibold flex items-center gap-1 shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Record Contribution</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowDecideProfitModal(true)}
                    disabled={investments.length === 0}
                    className="px-3 py-1.5 rounded-xl border border-[#7a2e4a] text-[#7a2e4a] dark:text-[#d77a9c] font-semibold disabled:opacity-40"
                  >
                    <span>Decide Profit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPayoutModal(true)}
                    className="px-3 py-1.5 rounded-xl border border-emerald-600 text-emerald-700 dark:text-emerald-400 font-semibold"
                  >
                    <span>Record Payout</span>
                  </button>
                </div>
              </div>

              {/* Investments Summary Cards */}
              <div className="space-y-2">
                <h4 className="font-bold text-xs">Active Investments ({investments.length})</h4>
                <div className="space-y-2">
                  {investments.map((inv) => (
                    <div
                      key={inv.investmentId}
                      className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">
                            #{inv.investmentId.slice(0, 8)}
                          </span>
                          <span className="text-[#6b625e]">
                            Invested {new Date(inv.investedOn).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="font-extrabold tabular-nums text-sm">
                          PKR {(inv.investedPaisa / 100).toLocaleString()}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t border-[#e6dfdb]/40">
                        <div>
                          <span className="text-[#6b625e] block">Principal Returned</span>
                          <span className="font-bold tabular-nums">
                            PKR {(inv.principalReturnedPaisa / 100).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#6b625e] block">Profit Decided</span>
                          <span className="font-bold tabular-nums">
                            PKR {(inv.profitDecidedPaisa / 100).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#6b625e] block">Profit Paid</span>
                          <span className="font-bold tabular-nums text-emerald-700">
                            PKR {(inv.profitPaidPaisa / 100).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {inv.note && (
                        <p className="text-[11px] text-[#6b625e] italic">"{inv.note}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Complete Statement Ledger */}
              <div className="space-y-2 pt-2">
                <h4 className="font-bold text-xs flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  <span>Transaction Statement ({statement.length} entries)</span>
                </h4>

                <div className="overflow-x-auto rounded-xl border border-[#e6dfdb] dark:border-[#3a3330]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#faf7f5] dark:bg-[#171413] border-b border-[#e6dfdb] font-semibold text-[#6b625e]">
                      <tr>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5">Action</th>
                        <th className="p-2.5 text-right">Amount (PKR)</th>
                        <th className="p-2.5">Details</th>
                        <th className="p-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e6dfdb]/60">
                      {statement.map((entry) => (
                        <tr key={entry.entryId} className={entry.reversed ? "opacity-40" : ""}>
                          <td className="p-2.5 whitespace-nowrap">
                            {new Date(entry.entryOn).toLocaleDateString()}
                          </td>
                          <td className="p-2.5 font-bold uppercase text-[10px] tracking-wider">
                            {entry.entryKind}
                            {entry.payoutKind ? ` (${entry.payoutKind})` : ""}
                          </td>
                          <td className="p-2.5 text-right font-bold tabular-nums">
                            {(entry.amountPaisa / 100).toLocaleString()}
                          </td>
                          <td className="p-2.5 text-[11px] text-[#6b625e] truncate max-w-xs">
                            {entry.note || entry.reference || "Recorded by " + entry.recordedByName}
                            {entry.reversed && " [REVERSED]"}
                          </td>
                          <td className="p-2.5 text-center">
                            {!entry.reversed && (
                              <button
                                type="button"
                                onClick={() =>
                                  setReversingEntry({
                                    id: entry.entryId,
                                    kind: entry.entryKind as any,
                                  })
                                }
                                className="p-1 rounded text-rose-600 hover:bg-rose-50"
                                title="Reverse entry"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e]">
              Select an investor from the registry to view investments, statements, and record profit decisions.
            </div>
          )}
        </div>
      </div>

      {/* ================= MODALS ================= */}

      {/* New Investor Modal */}
      {showNewInvestorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCreateInvestor}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Register Investor</h3>
              <button
                type="button"
                onClick={() => setShowNewInvestorModal(false)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold mb-1">Full Name:</label>
              <input
                type="text"
                required
                value={newInvestorName}
                onChange={(e) => setNewInvestorName(e.target.value)}
                placeholder="e.g. Tariq Mehmood"
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Phone Number (optional):</label>
              <input
                type="text"
                value={newInvestorPhone}
                onChange={(e) => setNewInvestorPhone(e.target.value)}
                placeholder="0300-..."
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Internal Note (optional):</label>
              <input
                type="text"
                value={newInvestorNote}
                onChange={(e) => setNewInvestorNote(e.target.value)}
                placeholder="Remarks..."
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewInvestorModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white font-semibold"
              >
                Save Investor
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Investment Modal */}
      {showAddInvestmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleAddInvestment}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Record Capital Contribution</h3>
              <button
                type="button"
                onClick={() => setShowAddInvestmentModal(false)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold mb-1">Amount (PKR):</label>
              <input
                type="number"
                min={1}
                required
                value={investmentAmountPkr || ""}
                onChange={(e) => setInvestmentAmountPkr(Math.max(0, Number(e.target.value) || 0))}
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Investment Date:</label>
              <input
                type="date"
                required
                value={investmentDate}
                onChange={(e) => setInvestmentDate(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Audit Note (optional):</label>
              <input
                type="text"
                value={investmentNote}
                onChange={(e) => setInvestmentNote(e.target.value)}
                placeholder="Bank transfer reference or purpose..."
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddInvestmentModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white font-semibold"
              >
                Record Capital
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Decide Profit Modal */}
      {showDecideProfitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleDecideProfit}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Discretionary Profit Decision</h3>
              <button
                type="button"
                onClick={() => setShowDecideProfitModal(false)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold mb-1">Target Investment:</label>
              <select
                value={targetInvestmentId}
                onChange={(e) => setTargetInvestmentId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              >
                {investments.map((inv) => (
                  <option key={inv.investmentId} value={inv.investmentId}>
                    Investment #{inv.investmentId.slice(0, 8)} (PKR {(inv.investedPaisa / 100).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Discretionary Profit Amount (PKR):</label>
              <input
                type="number"
                min={1}
                required
                value={profitAmountPkr || ""}
                onChange={(e) => setProfitAmountPkr(Math.max(0, Number(e.target.value) || 0))}
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Decision Date:</label>
              <input
                type="date"
                required
                value={profitDate}
                onChange={(e) => setProfitDate(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Management Rationale / Note:</label>
              <input
                type="text"
                required
                value={profitNote}
                onChange={(e) => setProfitNote(e.target.value)}
                placeholder="e.g. Q4 2026 performance distribution decision..."
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDecideProfitModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white font-semibold"
              >
                Record Decision
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Payout Modal */}
      {showPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleRecordPayout}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Disburse Investor Payout</h3>
              <button
                type="button"
                onClick={() => setShowPayoutModal(false)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">Payout Kind:</label>
                <select
                  value={payoutKind}
                  onChange={(e) => setPayoutKind(e.target.value as any)}
                  className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                >
                  <option value="profit">Disbursed Profit</option>
                  <option value="principal">Return of Principal</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1">Payment Method:</label>
                <select
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value as any)}
                  className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                >
                  <option value="bank">Bank Transfer</option>
                  <option value="cash">Cash Settlement</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">Payout Amount (PKR):</label>
              <input
                type="number"
                min={1}
                required
                value={payoutAmountPkr || ""}
                onChange={(e) => setPayoutAmountPkr(Math.max(0, Number(e.target.value) || 0))}
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Reference / Bank Transaction ID:</label>
              <input
                type="text"
                value={payoutRef}
                onChange={(e) => setPayoutRef(e.target.value)}
                placeholder="e.g. HBL-FT-99021..."
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Note (optional):</label>
              <input
                type="text"
                value={payoutNote}
                onChange={(e) => setPayoutNote(e.target.value)}
                placeholder="Remarks..."
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPayoutModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-emerald-700 text-white font-semibold"
              >
                Confirm Payout
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reverse Entry Confirmation Modal */}
      {reversingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs">
            <h3 className="font-bold text-sm text-rose-700">
              Reverse Ledger Entry #{reversingEntry.id.slice(0, 8)}
            </h3>
            <p className="text-[#6b625e]">
              Reversing creates an offsetting audit transaction. It cannot be undone.
            </p>
            <div>
              <label className="block font-semibold mb-1">Mandatory Reversal Reason:</label>
              <input
                type="text"
                required
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="e.g. Erroneous bank transfer amount entry..."
                className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReversingEntry(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reversalReason.trim()}
                onClick={handleReverseEntry}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-semibold disabled:opacity-50"
              >
                Confirm Reversal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
