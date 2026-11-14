import React, { useEffect, useRef } from "react";
import { Check, CheckCircle2, Layers, RefreshCw, X, XCircle } from "lucide-react";
import {
  summarizeSelectedOrderCards,
  type OrderCardBulkDecision,
} from "../lib/order-card-bulk";
import { when } from "../lib/time";
import type { OrderCardRecord } from "../server/types";

interface OrderCardBulkBarProps {
  pendingCount: number;
  selectedCount: number;
  selectedTotalPkr: number;
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelectAll: () => void;
  onOpenBulkModal: (decision: OrderCardBulkDecision) => void;
}

export const OrderCardBulkBar: React.FC<OrderCardBulkBarProps> = ({
  pendingCount,
  selectedCount,
  selectedTotalPkr,
  allSelected,
  someSelected,
  onToggleSelectAll,
  onOpenBulkModal,
}) => {
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  if (pendingCount === 0) return null;

  return (
    <div
      data-testid="order-card-bulk-bar"
      className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-2 text-xs"
    >
      <div className="flex items-center gap-2.5">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none min-h-[36px]">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            className="w-4 h-4 rounded accent-[#7a2e4a] cursor-pointer"
          />
          <span className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">
            Select all ({pendingCount})
          </span>
        </label>
        {selectedCount > 0 && (
          <span className="text-[#6b625e] dark:text-[#a59b96] tabular-nums">
            <span aria-hidden="true">· </span>
            {selectedCount} selected (PKR {selectedTotalPkr.toLocaleString()})
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => onOpenBulkModal("approve")}
          className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-45 hover:bg-[#66243d] whitespace-nowrap shrink-0 transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Approve Selected</span>
        </button>
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => onOpenBulkModal("reject")}
          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-[#211d1b] text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-1 disabled:opacity-45 hover:bg-rose-50 dark:hover:bg-rose-950/30 whitespace-nowrap shrink-0 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          <span>Reject Selected</span>
        </button>
      </div>
    </div>
  );
};

interface ConfirmBulkOrderCardsModalProps {
  cards: OrderCardRecord[];
  decision: OrderCardBulkDecision | null;
  isSubmitting: boolean;
  onChangeDecision: (decision: OrderCardBulkDecision) => void;
  onCancel: () => void;
  onConfirm: (cards: OrderCardRecord[], decision: OrderCardBulkDecision) => void;
}

export const ConfirmBulkOrderCardsModal: React.FC<ConfirmBulkOrderCardsModalProps> = ({
  cards,
  decision,
  isSubmitting,
  onChangeDecision,
  onCancel,
  onConfirm,
}) => {
  if (cards.length === 0 || !decision) return null;

  const summary = summarizeSelectedOrderCards(
    cards,
    cards.map((c) => c.id),
  );
  const isApprove = decision === "approve";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-order-cards-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isApprove
                  ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                  : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400"
              }`}
            >
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="bulk-order-cards-title"
                className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]"
              >
                Bulk Process Order Intake Cards
              </h3>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                {summary.selectedCount} {summary.selectedCount === 1 ? "request" : "requests"} ·{" "}
                {summary.totalUnits} units · PKR {summary.totalAmountPkr.toLocaleString()}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close bulk order cards confirmation"
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[#6b625e]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Decision Toggle */}
        <div
          role="group"
          aria-label="Bulk process decision"
          className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#f1eae6] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330]"
        >
          <button
            type="button"
            disabled={isSubmitting}
            aria-pressed={isApprove}
            onClick={() => onChangeDecision("approve")}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
              isApprove
                ? "bg-white dark:bg-[#211d1b] text-emerald-700 dark:text-emerald-400 shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19] dark:hover:text-[#f2eeec]"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Approve &amp; Convert</span>
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            aria-pressed={!isApprove}
            onClick={() => onChangeDecision("reject")}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
              !isApprove
                ? "bg-white dark:bg-[#211d1b] text-rose-700 dark:text-rose-400 shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19] dark:hover:text-[#f2eeec]"
            }`}
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Reject Orders</span>
          </button>
        </div>

        {/* Selected Order Cards List */}
        <div className="rounded-2xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] max-h-52 overflow-y-auto text-xs">
          {summary.selectedCards.map((card) => (
            <div key={card.id} className="p-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] truncate">
                  {card.salonName || "Salon"}
                </div>
                <div className="text-[#6b625e] dark:text-[#a59b96]">
                  {card.qty}x {card.skuName} · {when(card.capturedAt)}
                </div>
                {card.notes && (
                  <div className="text-[11px] text-[#7a2e4a] dark:text-[#d77a9c] mt-0.5 truncate">
                    Note: {card.notes}
                  </div>
                )}
              </div>
              <span className="font-bold text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums shrink-0">
                PKR {card.totalAmount.toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-[#6b625e] dark:text-[#a59b96] leading-relaxed">
          {isApprove
            ? `Confirm below to approve all ${summary.selectedCount} selected order intake ${summary.selectedCount === 1 ? "card" : "cards"} and convert them into pending delivery orders.`
            : `Confirm below to decline all ${summary.selectedCount} selected order intake ${summary.selectedCount === 1 ? "card" : "cards"}. Declined requests will be removed from pending dispatch approvals.`}
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onConfirm(summary.selectedCards, decision)}
            className={`min-h-[42px] px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 ${
              isApprove
                ? "bg-emerald-700 hover:bg-emerald-800"
                : "bg-rose-700 hover:bg-rose-800"
            }`}
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Processing {summary.selectedCount}...</span>
              </>
            ) : isApprove ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm Approve ({summary.selectedCount})</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4" />
                <span>Confirm Reject ({summary.selectedCount})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
