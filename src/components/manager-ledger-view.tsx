import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Building,
  Building2,
  CheckCheck,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { fetchCashLedgerEntries } from "../lib/api";
import type { CashLedgerEntry, UserRole } from "../server/types";

interface ManagerLedgerViewProps {
  initialEntries?: CashLedgerEntry[];
  onRecordPaymentClick?: () => void;
  onReversePaymentClick?: (paymentId: string) => void;
  onViewReceipt?: (receiptNumber: string) => void;
  userRole?: UserRole;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
}

export const ManagerLedgerView: React.FC<ManagerLedgerViewProps> = ({
  initialEntries,
  onRecordPaymentClick,
  onReversePaymentClick,
  onViewReceipt,
  userRole = "manager",
  showToast,
}) => {
  const [entries, setEntries] = useState<CashLedgerEntry[]>(initialEntries ?? []);
  const [loading, setLoading] = useState(!initialEntries || initialEntries.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | "bank_transfer" | "settlement" | "reversal">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "reversed">("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [detailEntry, setDetailEntry] = useState<CashLedgerEntry | null>(null);

  const loadLedger = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCashLedgerEntries();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch cash ledger entries from Supabase.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialEntries || initialEntries.length === 0) {
      void loadLedger();
    } else {
      setEntries(initialEntries);
    }
  }, [initialEntries]);

  // Compute live KPI metrics
  const kpis = useMemo(() => {
    let totalInflow = 0;
    let bankTransferTotal = 0;
    let bankTransferCount = 0;
    let cashSettlementTotal = 0;
    let cashSettlementCount = 0;
    let pendingCount = 0;
    let reversalCount = 0;
    let reversalTotal = 0;

    for (const e of entries) {
      if (e.status === "pending") {
        pendingCount++;
      }
      if (e.status === "reversed" || e.entryType === "reversal") {
        reversalCount++;
        reversalTotal += Math.abs(e.amountPkr);
      } else {
        totalInflow += e.amountPkr;
        if (e.entryType === "bank_transfer") {
          bankTransferTotal += e.amountPkr;
          bankTransferCount++;
        } else if (e.entryType === "settlement" || e.entryType === "cash_collection") {
          cashSettlementTotal += e.amountPkr;
          cashSettlementCount++;
        }
      }
    }

    const latestBalance = entries.length > 0 ? entries[0].balanceAfterPkr : totalInflow;

    return {
      totalInflow,
      bankTransferTotal,
      bankTransferCount,
      cashSettlementTotal,
      cashSettlementCount,
      pendingCount,
      reversalCount,
      reversalTotal,
      latestBalance,
    };
  }, [entries]);

  // Filtered and sorted entries
  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = entries.filter((e) => {
      if (methodFilter !== "all") {
        if (methodFilter === "bank_transfer" && e.entryType !== "bank_transfer") return false;
        if (methodFilter === "settlement" && e.entryType !== "settlement" && e.entryType !== "cash_collection") return false;
        if (methodFilter === "reversal" && e.entryType !== "reversal" && e.status !== "reversed") return false;
      }

      if (statusFilter !== "all" && e.status !== statusFilter) {
        return false;
      }

      if (q) {
        const matchNum = e.entryNumber.toLowerCase().includes(q);
        const matchSalon = (e.salonName ?? "").toLowerCase().includes(q);
        const matchRef = (e.referenceId ?? "").toLowerCase().includes(q);
        const matchReceipt = (e.receiptNumber ?? "").toLowerCase().includes(q);
        const matchBank = (e.bankName ?? "").toLowerCase().includes(q);
        const matchBankRef = (e.bankReference ?? "").toLowerCase().includes(q);
        const matchActor = (e.actorName ?? "").toLowerCase().includes(q);
        const matchNotes = (e.notes ?? "").toLowerCase().includes(q);

        if (
          !matchNum &&
          !matchSalon &&
          !matchRef &&
          !matchReceipt &&
          !matchBank &&
          !matchBankRef &&
          !matchActor &&
          !matchNotes
        ) {
          return false;
        }
      }

      return true;
    });

    return filtered.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });
  }, [entries, searchQuery, methodFilter, statusFilter, sortOrder]);

  const handleExportCsv = () => {
    if (filteredEntries.length === 0) {
      showToast("No ledger entries to export.", "warn");
      return;
    }

    const headers = [
      "Entry Number",
      "Date (PKT)",
      "Channel Type",
      "Salon Name",
      "Reference Type",
      "Reference ID",
      "Receipt Number",
      "Bank Name",
      "Bank Transfer Reference",
      "Amount (PKR)",
      "Balance After (PKR)",
      "Recorded By",
      "Approval Status",
      "Notes",
    ];

    const escapeCsv = (str: string | number | null | undefined): string => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = filteredEntries.map((e) => [
      escapeCsv(e.entryNumber),
      escapeCsv(new Date(e.createdAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })),
      escapeCsv(e.entryType === "bank_transfer" ? "Bank-to-Bank" : e.entryType === "reversal" ? "Audit Reversal" : "Cash-to-Cash"),
      escapeCsv(e.salonName ?? "Office Handover"),
      escapeCsv(e.referenceType),
      escapeCsv(e.referenceId),
      escapeCsv(e.receiptNumber ?? "N/A"),
      escapeCsv(e.bankName ?? "N/A"),
      escapeCsv(e.bankReference ?? "N/A"),
      escapeCsv(e.amountPkr),
      escapeCsv(e.balanceAfterPkr),
      escapeCsv(e.actorName ?? "Office Manager"),
      escapeCsv(e.status),
      escapeCsv(e.notes ?? ""),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `kiran-cash-ledger-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${filteredEntries.length} ledger entries to CSV.`, "ok");
  };

  return (
    <div className="space-y-5">
      {/* Top Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg text-[#1d1a19] dark:text-[#f2eeec]">
            Cash &amp; Bank Settlement Ledger
          </h2>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
            Immutable record of off-app Bank-to-Bank and Cash-to-Cash settlements synchronized with Supabase
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onRecordPaymentClick && (
            <button
              type="button"
              onClick={onRecordPaymentClick}
              className="px-3.5 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs hover:bg-[#66243d] whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Settlement</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a] whitespace-nowrap shrink-0 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => void loadLedger()}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a] whitespace-nowrap shrink-0 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Total Settled Inflow</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
            PKR {kpis.totalInflow.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5 tabular-nums">
            {entries.filter((e) => e.status !== "reversed").length} verified transactions
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Bank-to-Bank Transfers</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[#1d1a19] dark:text-[#f2eeec]">
            PKR {kpis.bankTransferTotal.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5 tabular-nums">
            {kpis.bankTransferCount} verified IBFT receipts
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Cash-to-Cash Handovers</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[#1d1a19] dark:text-[#f2eeec]">
            PKR {kpis.cashSettlementTotal.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5 tabular-nums">
            {kpis.cashSettlementCount} office receipts
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330]">
          <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Reversals &amp; Audit Logs</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-amber-700 dark:text-amber-300">
            {kpis.reversalCount}
          </div>
          <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5 tabular-nums">
            PKR {kpis.reversalTotal.toLocaleString()} reversed
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#6b625e] dark:text-[#a59b96]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entry #, salon, IBFT ref, receipt #, actor..."
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

        {/* Method segmented buttons */}
        <div className="flex items-center gap-1 bg-[#faf7f5] dark:bg-[#171413] p-1 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs">
          {(
            [
              { id: "all", label: "All Types" },
              { id: "bank_transfer", label: "Bank-to-Bank" },
              { id: "settlement", label: "Cash-to-Cash" },
              { id: "reversal", label: "Reversals" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMethodFilter(tab.id)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
                methodFilter === tab.id
                  ? "bg-white dark:bg-[#211d1b] text-[#7a2e4a] dark:text-[#d77a9c] shadow-xs font-semibold"
                  : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Status segmented buttons */}
        <div className="flex items-center gap-1 bg-[#faf7f5] dark:bg-[#171413] p-1 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs">
          {(
            [
              { id: "all", label: "All Status" },
              { id: "approved", label: "Approved" },
              { id: "pending", label: "Pending" },
              { id: "reversed", label: "Reversed" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === tab.id
                  ? "bg-white dark:bg-[#211d1b] text-[#7a2e4a] dark:text-[#d77a9c] shadow-xs font-semibold"
                  : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center justify-between text-xs text-red-700 dark:text-red-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadLedger()}
            className="px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 font-medium whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Ledger Table */}
      <section
        aria-label="Cash Ledger Table"
        className="rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] overflow-hidden shadow-xs"
      >
        <div className="px-4 py-2.5 border-b border-[#e6dfdb] dark:border-[#3a3330] flex items-center justify-between gap-3 text-xs">
          <div className="text-[#6b625e] dark:text-[#a59b96] tabular-nums">
            Showing <span className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">{filteredEntries.length}</span> of {entries.length} entries
          </div>

          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
            className="flex items-center gap-1 text-[#6b625e] hover:text-[#1d1a19] dark:text-[#a59b96] dark:hover:text-[#f2eeec] font-medium"
          >
            <span>Date: {sortOrder === "desc" ? "Newest First" : "Oldest First"}</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-[#6b625e] dark:text-[#a59b96]">
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Entry # &amp; Date</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Client Salon</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Method &amp; Channel</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Receipt / Ref</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap text-right">Amount (PKR)</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap text-right">Balance After</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Recorded By</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Approval Status</th>
                <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6dfdb] dark:divide-[#3a3330]">
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#6b625e] dark:text-[#a59b96]">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-[#7a2e4a]" />
                      <span>Loading cash ledger from Supabase...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#6b625e] dark:text-[#a59b96]">
                    No settlement entries found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((e) => {
                  const isReversal = e.status === "reversed" || e.entryType === "reversal";
                  const isBank = e.entryType === "bank_transfer";
                  const dateStr = new Date(e.createdAt).toLocaleDateString("en-PK", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  const timeStr = new Date(e.createdAt).toLocaleTimeString("en-PK", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <tr
                      key={e.id}
                      className="hover:bg-[#faf7f5]/80 dark:hover:bg-[#1a1716] transition-colors"
                    >
                      {/* Entry # and Date */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="font-mono font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                          {e.entryNumber}
                        </div>
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                          {dateStr} <span aria-hidden="true">·</span> {timeStr}
                        </div>
                      </td>

                      {/* Salon */}
                      <td className="py-2.5 px-3.5">
                        <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] line-clamp-1 max-w-[180px]">
                          {e.salonName ?? "Karachi Client"}
                        </div>
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          {e.referenceType === "reversal" ? "Audit Reversal" : "Salon Settlement"}
                        </div>
                      </td>

                      {/* Method & Bank Channel */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                          {isBank ? (
                            <>
                              <Building className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                              <span>{e.bankName || "Bank Transfer"}</span>
                            </>
                          ) : isReversal ? (
                            <>
                              <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                              <span>Reversal Adjustment</span>
                            </>
                          ) : (
                            <>
                              <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span>Cash Handover</span>
                            </>
                          )}
                        </div>
                        {e.bankReference && (
                          <div className="text-[11px] font-mono text-[#6b625e] dark:text-[#a59b96]">
                            Ref: {e.bankReference}
                          </div>
                        )}
                      </td>

                      {/* Receipt */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono">
                        {e.receiptNumber ? (
                          <button
                            type="button"
                            onClick={() => onViewReceipt?.(e.receiptNumber!)}
                            className="text-[#7a2e4a] dark:text-[#d77a9c] hover:underline font-semibold"
                          >
                            {e.receiptNumber}
                          </button>
                        ) : (
                          <span className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Direct Entry</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap text-right font-mono tabular-nums font-semibold">
                        {isReversal ? (
                          <span className="text-red-700 dark:text-red-400">
                            -PKR {Math.abs(e.amountPkr).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            +PKR {e.amountPkr.toLocaleString()}
                          </span>
                        )}
                      </td>

                      {/* Balance After */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap text-right font-mono tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
                        PKR {e.balanceAfterPkr.toLocaleString()}
                      </td>

                      {/* Recorded By */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                          {e.actorName || "Office Manager"}
                        </div>
                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] capitalize">
                          {e.actorRole || "Office"}
                        </div>
                      </td>

                      {/* Approval Status: strict zero-pill discipline (no colored pill badges) */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        {e.status === "approved" || e.status === "verified" ? (
                          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                            <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>Approved</span>
                          </div>
                        ) : e.status === "reversed" ? (
                          <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-medium">
                            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                            <span>Reversed</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                            <span>Pending Review</span>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3.5 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailEntry(e)}
                            title="View Transaction Audit Details"
                            className="p-1 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 text-[#6b625e] hover:text-[#1d1a19] dark:text-[#a59b96] dark:hover:text-[#f2eeec] transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {e.receiptNumber && onViewReceipt && (
                            <button
                              type="button"
                              onClick={() => onViewReceipt(e.receiptNumber!)}
                              title="Print or View Receipt"
                              className="px-2 py-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-[11px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:border-[#7a2e4a] transition-colors"
                            >
                              Receipt
                            </button>
                          )}

                          {!isReversal && onReversePaymentClick && e.referenceId && (
                            <button
                              type="button"
                              onClick={() => onReversePaymentClick(e.referenceId)}
                              title="Audit Reversal / Void"
                              className="px-2 py-1 rounded-lg border border-red-200 dark:border-red-900/60 text-[11px] font-semibold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            >
                              Reverse
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Transaction Detail Modal */}
      {detailEntry && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] p-5 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#e6dfdb] dark:border-[#3a3330] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                  Ledger Entry Details
                </h3>
                <p className="text-xs text-[#6b625e] dark:text-[#a59b96] font-mono mt-0.5">
                  {detailEntry.entryNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailEntry(null)}
                className="p-1 rounded-lg text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-[#f2eeec]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330]">
                <div>
                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Settlement Amount</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                    PKR {detailEntry.amountPkr.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Running Balance After</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-[#1d1a19] dark:text-[#f2eeec] mt-0.5">
                    PKR {detailEntry.balanceAfterPkr.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 py-1">
                <div>
                  <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Client Salon</div>
                  <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">
                    {detailEntry.salonName || "Office Client"}
                  </div>
                </div>

                <div>
                  <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Channel Method</div>
                  <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] capitalize">
                    {detailEntry.entryType === "bank_transfer" ? "Bank-to-Bank Transfer" : "Cash-to-Cash Handover"}
                  </div>
                </div>

                {detailEntry.bankName && (
                  <div>
                    <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Bank Name</div>
                    <div className="font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                      {detailEntry.bankName}
                    </div>
                  </div>
                )}

                {detailEntry.bankReference && (
                  <div>
                    <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">IBFT Reference</div>
                    <div className="font-mono text-[#1d1a19] dark:text-[#f2eeec]">
                      {detailEntry.bankReference}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Official Receipt</div>
                  <div className="font-mono font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                    {detailEntry.receiptNumber || "N/A"}
                  </div>
                </div>

                <div>
                  <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Recorded By</div>
                  <div className="font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                    {detailEntry.actorName || "Office Manager"} ({detailEntry.actorRole || "manager"})
                  </div>
                </div>

                <div>
                  <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Captured At</div>
                  <div className="font-mono text-[#1d1a19] dark:text-[#f2eeec] tabular-nums">
                    {new Date(detailEntry.createdAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}
                  </div>
                </div>

                <div>
                  <div className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">Approval Status</div>
                  <div className="font-semibold capitalize text-[#1d1a19] dark:text-[#f2eeec]">
                    {detailEntry.status}
                  </div>
                </div>
              </div>

              {detailEntry.notes && (
                <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330]">
                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] font-medium">Audit Notes</div>
                  <div className="text-[#1d1a19] dark:text-[#f2eeec] mt-0.5">{detailEntry.notes}</div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e6dfdb] dark:border-[#3a3330]">
              {detailEntry.receiptNumber && onViewReceipt && (
                <button
                  type="button"
                  onClick={() => {
                    const r = detailEntry.receiptNumber!;
                    setDetailEntry(null);
                    onViewReceipt(r);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:border-[#7a2e4a]"
                >
                  View Receipt
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailEntry(null)}
                className="px-4 py-1.5 rounded-xl bg-[#1d1a19] dark:bg-[#f2eeec] text-white dark:text-[#1d1a19] text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
