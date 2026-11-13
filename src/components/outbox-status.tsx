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
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";

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
  const isSyncing = isDraining || state.transmittingIds.length > 0;

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
      <div className="max-w-md md:max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-2">
        {/* Connection & Sync Status Indicator */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSimulatedOffline(!state.simulatedOffline)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition-colors ${
              offline
                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200"
                : isSyncing
                ? "bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-200"
                : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300"
            }`}
            title="Click to toggle simulated offline mode for field testing"
          >
            {offline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Offline {state.simulatedOffline && "(Simulated)"}</span>
              </>
            ) : isSyncing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600 dark:text-sky-400" />
                <span>Syncing...</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Online</span>
              </>
            )}
          </button>

          {/* Pending items waiting to process indicator */}
          {pending.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 font-bold text-[11px] border border-amber-300/60 dark:border-amber-800/60">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1" />
                {pending.length} {pending.length === 1 ? "item" : "items"} waiting
              </span>
            </div>
          )}

          {pending.length === 0 && rejected.length === 0 && state.lastSyncAt && !isSyncing && (
            <span className="text-[#6b625e] dark:text-[#a59b96] hidden sm:inline">
              Synced {when(state.lastSyncAt)}
            </span>
          )}
        </div>

        {/* Action buttons & Attention toggle */}
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
            <span>{isSyncing ? "Syncing..." : "Sync"}</span>
          </button>
        </div>
      </div>

      {/* Transmitting Progress Bar Banner */}
      {state.transmittingIds.length > 0 && (
        <div className="bg-sky-50 dark:bg-sky-950/40 border-t border-sky-200 dark:border-sky-900/40 px-4 py-2">
          <div className="max-w-md md:max-w-5xl mx-auto space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-sky-900 dark:text-sky-200">
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin text-sky-600 dark:text-sky-400" />
                Transmitting action to server ({state.transmittingIds.length} active)
              </span>
              <span>
                {Math.round(
                  Object.values(state.activeProgress).reduce((a, b) => a + b, 0) /
                    Math.max(1, Object.keys(state.activeProgress).length)
                )}
                %
              </span>
            </div>
            <div className="w-full h-1.5 bg-sky-200 dark:bg-sky-900/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-600 dark:bg-sky-400 transition-all duration-300 ease-out"
                style={{
                  width: `${Math.round(
                    Object.values(state.activeProgress).reduce((a, b) => a + b, 0) /
                      Math.max(1, Object.keys(state.activeProgress).length)
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Expandable Needs Attention & Queue Details Drawer */}
      {expanded && (
        <div className="max-w-md md:max-w-5xl mx-auto px-4 py-3 border-t border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]">
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

                {item.error && (
                  <div className="text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 p-2 rounded text-[11px]">
                    <strong>Refusal reason:</strong> {item.error || "The server rejected this submission."}
                  </div>
                )}

                {state.transmittingIds?.includes(item.id) && (
                  <div className="space-y-1 py-1">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                      <span className="flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Transmitting to server...
                      </span>
                      <span>{state.activeProgress?.[item.id] ?? 50}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-[#e6dfdb] dark:bg-[#3a3330] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#7a2e4a] dark:bg-[#d77a9c] transition-all duration-300 ease-out"
                        style={{ width: `${state.activeProgress?.[item.id] ?? 50}%` }}
                      />
                    </div>
                  </div>
                )}

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
                        onClick={() => handleDiscard(item.id)}
                        disabled={state.transmittingIds?.includes(item.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[#6b625e] hover:text-rose-600 font-medium rounded disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Discard</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRetry(item.id)}
                        disabled={state.transmittingIds?.includes(item.id)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#7a2e4a] text-white font-medium rounded hover:opacity-90 disabled:opacity-40"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${state.transmittingIds?.includes(item.id) ? "animate-spin" : ""}`} />
                        <span>{state.transmittingIds?.includes(item.id) ? "Transmitting..." : "Retry"}</span>
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
        <div className="bg-amber-500/10 dark:bg-amber-950/40 border-t border-amber-300/40 px-4 py-1.5 text-center text-amber-900 dark:text-amber-200 font-medium">
          Field Mode: Working offline. All visits, counts, and payments are stored securely on this phone.
        </div>
      )}
    </div>
  );
};
