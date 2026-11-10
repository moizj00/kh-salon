import { type DrainReport, drain } from "./drain";
import { enqueue, retry } from "./queue";
import { openIdbStore } from "./store-idb";
import type { Dependency, OutboxFn, OutboxItem, OutboxStore } from "./types";

const USER_KEY = "kiran.outbox.user";
const DEFAULT_USER_ID = "rep-karachi-pilot-01";
const DRAIN_LOCK = "kiran.outbox.drain";
const CHANNEL = "kiran.outbox";
const SYNC_INTERVAL_MS = 30_000;
const SUBMIT_WAIT_MS = 3_000;
const STALL_TIMEOUT_MS = 30_000;

export type SubmitInput = {
  id: string;
  fn: OutboxFn;
  args: Record<string, unknown>;
  label: string;
  salonId: string | null;
  capturedAt: string;
  dependsOn?: Dependency;
};

export type SyncState = {
  held: DrainReport["held"];
  lastSyncAt: number | null;
  error: string | null;
  simulatedOffline: boolean;
  transmittingIds: string[];
  activeProgress: Record<string, number>;
};

const inFlightItemIds = new Set<string>();
const transmittingProgress = new Map<string, number>();
const itemStallTimers = new Map<string, ReturnType<typeof setTimeout>>();

const listeners = new Set<() => void>();
const local: {
  state: SyncState;
  draining: Promise<DrainReport> | null;
  channel: BroadcastChannel | null;
} = {
  state: {
    held: "none",
    lastSyncAt: null,
    error: null,
    simulatedOffline: false,
    transmittingIds: [],
    activeProgress: {},
  },
  draining: null,
  channel: null,
};

function setItemProgress(id: string, percent: number | null) {
  if (percent === null) {
    inFlightItemIds.delete(id);
    transmittingProgress.delete(id);
    if (itemStallTimers.has(id)) {
      clearTimeout(itemStallTimers.get(id));
      itemStallTimers.delete(id);
    }
  } else {
    inFlightItemIds.add(id);
    transmittingProgress.set(id, Math.min(100, Math.max(0, percent)));

    if (!itemStallTimers.has(id)) {
      const timer = setTimeout(() => {
        setItemProgress(id, null);
      }, STALL_TIMEOUT_MS);
      itemStallTimers.set(id, timer);
    }
  }
  changed();
}

export function isItemTransmitting(id: string): boolean {
  return inFlightItemIds.has(id);
}

const tellListeners = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.error(e);
    }
  });
};

const channel = (): BroadcastChannel | null => {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!local.channel) {
    local.channel = new BroadcastChannel(CHANNEL);
    local.channel.onmessage = tellListeners;
  }
  return local.channel;
};

const changed = (state: Partial<SyncState> = {}) => {
  local.state = {
    ...local.state,
    ...state,
    transmittingIds: Array.from(inFlightItemIds),
    activeProgress: Object.fromEntries(transmittingProgress.entries()),
  };
  tellListeners();
  try {
    channel()?.postMessage("changed");
  } catch {
    // Ignore channel errors
  }
};

export const isOffline = (): boolean => {
  if (local.state.simulatedOffline) return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
};

export function setSimulatedOffline(offline: boolean) {
  changed({ simulatedOffline: offline, held: offline ? "offline" : "none" });
  if (!offline) {
    void quietSync();
  }
}

export const captureUserId = async (): Promise<string> => {
  if (typeof window === "undefined") return DEFAULT_USER_ID;
  const id = window.localStorage.getItem(USER_KEY) ?? DEFAULT_USER_ID;
  window.localStorage.setItem(USER_KEY, id);
  return id;
};

export function setSessionUserId(id: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(USER_KEY, id);
    changed();
  }
}

// In-app mock execution handler when live DB is offline or for simulated testing
const mockServerDispatch = async (fn: OutboxFn, args: Record<string, unknown>, itemId?: string): Promise<unknown> => {
  const id = itemId || (args.p_id as string) || (args.id as string);

  if (id) {
    setItemProgress(id, 15);
  }

  await new Promise((r) => setTimeout(r, 200));

  if (id && inFlightItemIds.has(id)) {
    setItemProgress(id, 45);
  }

  if (isOffline()) {
    if (id) setItemProgress(id, null);
    throw new Error("Network unreachable (offline)");
  }

  await new Promise((r) => setTimeout(r, 250));

  if (id && inFlightItemIds.has(id)) {
    setItemProgress(id, 80);
  }

  let result: unknown = { success: true, fn, timestamp: new Date().toISOString() };

  // Realistic mock validations and outcomes:
  if (fn === "rep_check_in") {
    if (args.p_fail || args.fail) {
      if (id) setItemProgress(id, null);
      throw new Error("Invalid check-in parameters. Count cannot be negative.");
    }
    const bagCount = (args.p_bag_count ?? args.bag_count) as number | undefined;
    result = {
      rep_day_id: "day-" + Date.now(),
      status: "open",
      opened_at: new Date().toISOString(),
      bag_variance_units: 0,
      initial_count: bagCount ?? 24,
    };
  } else if (fn === "log_visit") {
    result = {
      visit_id: args.p_id ?? "visit-" + Date.now(),
      status: "completed",
      recorded_at: new Date().toISOString(),
    };
  } else if (fn === "rep_record_payment") {
    const amount = Number(args.p_amount ?? args.amount ?? 0);
    result = {
      payment_id: args.p_id ?? "pay-" + Date.now(),
      amount,
      currency: "PKR",
      status: "receipt_pending",
    };
  } else if (fn === "create_salon") {
    result = {
      salon_id: args.p_id ?? "sal-" + Date.now(),
      name: args.p_name,
      status: "prospect",
    };
  } else if (fn === "rep_submit_delivery") {
    result = {
      submission_id: args.p_id ?? "del-" + Date.now(),
      order_id: args.p_order_id,
      status: "submitted",
    };
  } else if (fn === "rep_attach_signature") {
    result = {
      signature_id: args.p_id ?? "sig-" + Date.now(),
      attached: true,
    };
  }

  if (id) {
    setItemProgress(id, 100);
    await new Promise((r) => setTimeout(r, 100));
    setItemProgress(id, null);
  }

  return result;
};

const send = async (fn: OutboxFn, args: Record<string, unknown>, itemId?: string): Promise<unknown> => {
  return await mockServerDispatch(fn, args, itemId);
};

const withDrainLock = async <T>(run: () => Promise<T>): Promise<T | "busy"> => {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    try {
      return (await navigator.locks.request(DRAIN_LOCK, { ifAvailable: true }, (lock) =>
        lock ? run() : "busy",
      )) as T | "busy";
    } catch {
      return run();
    }
  }
  return run();
};

const runDrain = async (): Promise<DrainReport> => {
  const userId = await captureUserId();
  if (isOffline()) {
    return { sent: 0, rejected: 0, held: "offline" };
  }
  const store = await openIdbStore();
  return drain({ store, userId, send, now: Date.now, lock: withDrainLock });
};

export async function sync(): Promise<DrainReport> {
  if (local.draining) return local.draining;
  local.draining = runDrain();
  try {
    const report = await local.draining;
    changed({
      held: report.held,
      error: null,
      ...(report.held === "none" ? { lastSyncAt: Date.now() } : {}),
    });
    return report;
  } catch (error) {
    changed({ error: error instanceof Error ? error.message : "The waiting list could not be read." });
    throw error;
  } finally {
    local.draining = null;
  }
}

export const quietSync = async (): Promise<void> => {
  try {
    await sync();
  } catch {
    // Logged in sync state
  }
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function submit(input: SubmitInput): Promise<"sent" | "queued" | "rejected"> {
  // Prevent duplicate submission of the same action ID if already in-flight or rapidly tapped
  if (inFlightItemIds.has(input.id)) {
    console.warn(`[Outbox] Duplicate submission prevented for action ID: ${input.id}`);
    const store = await openIdbStore();
    const mine = await store.list(await captureUserId());
    const existing = mine.find((it) => it.id === input.id);
    if (existing) return existing.state === "rejected" ? "rejected" : "queued";
  }

  const userId = await captureUserId();
  const store = await openIdbStore();
  await enqueue(store, { ...input, userId, dependsOn: input.dependsOn ?? null });
  changed();

  if (isOffline()) return "queued";

  await Promise.race([quietSync(), wait(SUBMIT_WAIT_MS)]);
  const mine = await store.list(userId);
  const item = mine.find((other) => other.id === input.id);
  if (!item) return "sent";
  return item.state === "rejected" ? "rejected" : "queued";
}

export async function listItems(): Promise<OutboxItem[]> {
  const store = await openIdbStore();
  return store.list(await captureUserId());
}

export async function retryItem(id: string): Promise<void> {
  // Prevent duplicate submission of the same action ID if user taps retry rapidly or sync is in flight
  if (inFlightItemIds.has(id)) {
    console.warn(`[Outbox] Retry ignored for action ID ${id} as it is already transmitting.`);
    return;
  }

  setItemProgress(id, 5);
  try {
    const store = await openIdbStore();
    await retry(store, id);
    changed();
    await quietSync();
  } catch (err) {
    setItemProgress(id, null);
    throw err;
  }
}

export async function discardItem(id: string): Promise<void> {
  setItemProgress(id, null);
  const store = await openIdbStore();
  await store.remove(id);
  changed();
}

export const syncState = (): SyncState => local.state;

export function subscribe(listener: () => void): () => void {
  channel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startSync(): () => void {
  const kick = () => {
    void quietSync();
  };
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") kick();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(kick, SYNC_INTERVAL_MS);
    void navigator.storage?.persist?.();
    kick();

    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }
  return () => {};
}

export async function wipeLocalData(): Promise<void> {
  const store = await openIdbStore();
  await store.clear();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(USER_KEY);
  }
  inFlightItemIds.clear();
  transmittingProgress.clear();
  itemStallTimers.forEach((t) => clearTimeout(t));
  itemStallTimers.clear();
  changed({ held: "none", lastSyncAt: null, error: null, transmittingIds: [], activeProgress: {} });
}
