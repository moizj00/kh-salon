import React, { useEffect, useState } from "react";
import {
  discardItem,
  isOffline,
  listItems,
  retryItem,
  setSimulatedOffline,
  subscribe,
  sync,
  syncState,
  type SyncState,
} from "../lib/outbox";
import type { OutboxItem } from "../lib/outbox/types";
import { when } from "../lib/time";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";

export const OutboxStatus: React.FC = () => {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [state, setState] = useState<SyncState>(syncState());
  const [expanded, setExpanded] = useState(false);
  const [isDraining, setIsDraining] = useState(false);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const all = await listItems();
      setItems(all);
      setState(syncState());
    } catch (e) {
      console.warn("Failed to read outbox list:", e);
    }
  };

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribe(() => {
      void refresh();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const pending = items.filter((i) => i.state === "pending");
  const rejected = items.filter((i) => i.state === "rejected");
  const offline = isOffline();

  const handleManualSync = async () => {
    setIsDraining(true);
    try {
      await sync();
    } catch {
      // Handled in sync state
    } finally {
      setIsDraining(false);
      void refresh();
    }
  };

  const handleRetry = async (id: string) => {
    await retryItem(id);
    void refresh();
  };

  const handleDiscard = async (id: string) => {
    await discardItem(id);
    setConfirmDiscardId(null);
    void refresh();
  };

  return (
    <div className="w-full bg-white dark:bg-[#211d1b] border-b border-[#e6dfdb] dark:border-[#3a3330] shadow-xs text-xs">
      <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between gap-2">
        {/* Connection status & quick offline simulator toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSimulatedOffline(!state.simulatedOffline)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors ${
              offline
                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200"
                : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300"
            }`}
            title="Click to toggle simulated offline mode for field testing"
          >
            {offline ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline {state.simulatedOffline && "(Simulated)"}</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>Online</span>
              </>
            )}
          </button>

          {/* Pending queue badge */}
          {pending.length > 0 && (
            <span className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Waiting to send ({pending.length})
            </span>
          )}

          {pending.length === 0 && rejected.length === 0 && state.lastSyncAt && (
            <span className="text-[#6b625e] dark:text-[#a59b96] hidden sm:inline">
              Synced {when(state.lastSyncAt)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {rejected.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-2 py-1 rounded-md"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Needs attention ({rejected.length})</span>
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}

          <button
            type="button"
            onClick={handleManualSync}
            disabled={isDraining || offline}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#7a2e4a] text-white font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
            title="Send all queued actions now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isDraining ? "animate-spin" : ""}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Expandable Needs Attention & Queue Details Drawer */}
      {expanded && (
        <div className="max-w-md mx-auto px-4 py-3 border-t border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]">
          <h4 className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] mb-2 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>Needs Attention ({rejected.length})</span>
          </h4>
          <p className="text-[#6b625e] dark:text-[#a59b96] mb-3">
            The server refused these actions. They are kept safely on your phone so no work is lost.
          </p>

          <div className="space-y-2">
            {rejected.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-[#211d1b] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                    {item.label}
                  </span>
                  <span className="text-[#6b625e] dark:text-[#a59b96] text-[11px]">
                    Captured {when(item.capturedAt)}
                  </span>
                </div>

                <div className="text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 p-2 rounded text-[11px]">
                  <strong>Refusal reason:</strong> {item.error || "The server rejected this submission."}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  {confirmDiscardId === item.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-rose-600 font-medium">Discard permanently?</span>
                      <button
                        type="button"
                        onClick={() => handleDiscard(item.id)}
                        className="px-2 py-1 bg-rose-600 text-white rounded font-medium hover:bg-rose-700"
                      >
                        Yes, Discard
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscardId(null)}
                        className="px-2 py-1 border border-[#e6dfdb] rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscardId(item.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[#6b625e] hover:text-rose-600 font-medium rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Discard</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRetry(item.id)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#7a2e4a] text-white font-medium rounded hover:opacity-90"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Offline banner notification when offline */}
      {offline && (
        <div className="bg-amber-500/10 dark:bg-amber-950/40 border-t border-amber-300/40 px-4 py-1.5 text-center text-amber-900 dark:text-amber-200">
          Field Mode: Working offline. All visits, counts, and payments are stored securely on this phone.
        </div>
      )}
    </div>
  );
};
