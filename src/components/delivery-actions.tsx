import React, { useEffect, useRef } from "react";
import {
  Bell,
  CheckCircle2,
  Lock,
  MoreVertical,
  Printer,
  Receipt,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { when } from "../lib/time";
import type { DeliveryOrderFull, SalonWithApproval } from "../server/types";

interface DeliveryQuickActionsMenuProps {
  order: DeliveryOrderFull;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onViewReceipt: (order: DeliveryOrderFull) => void;
  onResendNotification: (order: DeliveryOrderFull) => void;
  onRequestMarkDelivered: (order: DeliveryOrderFull) => void;
  canMarkDelivered: boolean;
  isNotifying: boolean;
}

export const DeliveryQuickActionsMenu: React.FC<DeliveryQuickActionsMenuProps> = ({
  order,
  isOpen,
  onToggle,
  onClose,
  onViewReceipt,
  onResendNotification,
  onRequestMarkDelivered,
  canMarkDelivered,
  isNotifying,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        aria-label={`Quick Actions for ${order.order_number}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs font-semibold text-[#1d1a19] dark:text-[#f2eeec] hover:border-[#7a2e4a] flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
      >
        <MoreVertical className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
        <span>Quick Actions</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={`Order actions for ${order.order_number}`}
          className="absolute right-0 mt-1.5 w-60 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xl z-40 p-1.5 space-y-0.5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onViewReceipt(order);
            }}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-medium text-[#1d1a19] dark:text-[#f2eeec] hover:bg-[#faf7f5] dark:hover:bg-[#171413] flex items-center gap-2.5 transition-colors"
          >
            <Receipt className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c] shrink-0" />
            <span>View Receipt</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={isNotifying}
            onClick={() => {
              onClose();
              onResendNotification(order);
            }}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-medium text-[#1d1a19] dark:text-[#f2eeec] hover:bg-[#faf7f5] dark:hover:bg-[#171413] disabled:opacity-50 flex items-center gap-2.5 transition-colors"
          >
            {isNotifying ? (
              <RefreshCw className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c] animate-spin shrink-0" />
            ) : (
              <Bell className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c] shrink-0" />
            )}
            <span>{isNotifying ? "Sending Notification..." : "Resend Notification"}</span>
          </button>

          {order.status !== "delivered" && (
            <>
              <div className="my-1 border-t border-[#e6dfdb]/60 dark:border-[#3a3330]" />
              <button
                type="button"
                role="menuitem"
                disabled={!canMarkDelivered}
                onClick={() => {
                  if (!canMarkDelivered) return;
                  onClose();
                  onRequestMarkDelivered(order);
                }}
                className={`w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
                  canMarkDelivered
                    ? "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    : "text-[#6b625e] dark:text-[#a59b96] opacity-60 cursor-not-allowed"
                }`}
              >
                {canMarkDelivered ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <Lock className="w-4 h-4 shrink-0" />
                )}
                <div className="min-w-0">
                  <div>Mark as Delivered</div>
                  {!canMarkDelivered && (
                    <div className="text-[10px] font-normal">Owner or Manager only</div>
                  )}
                </div>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface DeliveryReceiptModalProps {
  order: DeliveryOrderFull | null;
  salon?: SalonWithApproval | null;
  onClose: () => void;
}

export const DeliveryReceiptModal: React.FC<DeliveryReceiptModalProps> = ({
  order,
  salon,
  onClose,
}) => {
  if (!order) return null;

  const isDelivered = order.status === "delivered";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-receipt-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print-receipt-root"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-[#e6dfdb] dark:border-[#3a3330] flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
              KH Enterprises · Kiran DMS Official Receipt
            </div>
            <h3
              id="delivery-receipt-title"
              className="font-bold text-lg text-[#1d1a19] dark:text-[#f2eeec] font-mono mt-0.5"
            >
              {order.order_number}
            </h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96] mt-0.5">
              {isDelivered
                ? `Delivered ${order.delivered_at ? when(order.delivered_at) : ""}`
                : `Confirmed ${order.created_at ? when(order.created_at) : "for dispatch"}`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close receipt"
            onClick={onClose}
            className="no-print p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-[#6b625e] min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Receipt Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-[#e6dfdb]/60 dark:border-[#3a3330]">
            <div>
              <div className="text-[#6b625e] dark:text-[#a59b96]">Billed & Delivered To</div>
              <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] mt-0.5">
                {order.salon_name}
              </div>
              {salon?.address && (
                <div className="text-[#6b625e] dark:text-[#a59b96]">{salon.address}</div>
              )}
              {salon?.phone && (
                <div className="font-mono text-[#6b625e] dark:text-[#a59b96] mt-0.5">
                  {salon.phone}
                </div>
              )}
            </div>

            <div className="sm:text-right">
              <div className="text-[#6b625e] dark:text-[#a59b96]">Delivery Status</div>
              <div
                className={`font-bold text-sm mt-0.5 ${
                  isDelivered
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-300"
                }`}
              >
                {isDelivered ? "Delivered" : "Pending Delivery"}
              </div>
              <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] mt-0.5">
                {order.signature_data
                  ? "Customer digital signature attached"
                  : isDelivered
                    ? "Confirmed by Owner / Office Manager"
                    : "Awaiting delivery sign-off"}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]">
                  <th className="py-2 pr-2 font-semibold">Item</th>
                  <th className="py-2 px-2 font-semibold text-right">Qty</th>
                  <th className="py-2 px-2 font-semibold text-right">Unit (PKR)</th>
                  <th className="py-2 pl-2 font-semibold text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                {order.items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="py-2.5 pr-2 font-medium text-[#1d1a19] dark:text-[#f2eeec]">
                      {it.sku_name}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{it.qty}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {it.price.toLocaleString()}
                    </td>
                    <td className="py-2.5 pl-2 text-right font-semibold tabular-nums">
                      PKR {(it.qty * it.price).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#e6dfdb] dark:border-[#3a3330]">
                  <td colSpan={3} className="pt-3 font-bold text-sm text-right pr-2">
                    Invoice Total
                  </td>
                  <td className="pt-3 pl-2 text-right font-bold text-base text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                    PKR {order.total_amount.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="no-print p-4 border-t border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5]/60 dark:bg-[#171413]/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1.5 hover:opacity-95"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface ConfirmDeliveredModalProps {
  order: DeliveryOrderFull | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (order: DeliveryOrderFull) => void;
}

export const ConfirmDeliveredModal: React.FC<ConfirmDeliveredModalProps> = ({
  order,
  isSubmitting,
  onCancel,
  onConfirm,
}) => {
  if (!order) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delivered-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="confirm-delivered-title"
                className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]"
              >
                Confirm Delivery Completion
              </h3>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Owner / Manager Direct Status Update
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close confirmation dialog"
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[#6b625e]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs space-y-1">
          <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
            {order.order_number}
          </div>
          <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
            {order.salon_name}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[#6b625e] dark:text-[#a59b96]">Invoice Total</span>
            <span className="font-bold text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
              PKR {order.total_amount.toLocaleString()}
            </span>
          </div>
        </div>

        <p className="text-xs text-[#6b625e] dark:text-[#a59b96] leading-relaxed">
          Confirm below to change this order&apos;s status from Pending Delivery to Delivered.
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onConfirm(order)}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-800 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Updating Status...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>YES IT&apos;S DELIVERED</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
