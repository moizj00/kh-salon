import type { OutboxItem, OutboxPatch, OutboxStore } from "./types";

export type EnqueueInput = Omit<OutboxItem, "seq" | "state" | "attempts" | "nextAttemptAt" | "error">;

const copy = (item: OutboxItem): OutboxItem => ({ ...item, args: { ...item.args } });

export class MemoryStore implements OutboxStore {
  private readonly items = new Map<string, OutboxItem>();
  private lastSeq = 0;

  add(item: Omit<OutboxItem, "seq">): Promise<OutboxItem> {
    const existing = this.items.get(item.id);
    if (existing) return Promise.resolve(copy(existing));
    this.lastSeq += 1;
    const saved: OutboxItem = { ...item, seq: this.lastSeq };
    this.items.set(saved.id, saved);
    return Promise.resolve(copy(saved));
  }

  list(userId: string): Promise<OutboxItem[]> {
    const mine = [...this.items.values()].filter((item) => item.userId === userId);
    return Promise.resolve(mine.sort((a, b) => a.seq - b.seq).map(copy));
  }

  update(id: string, patch: OutboxPatch): Promise<void> {
    const item = this.items.get(id);
    if (item) this.items.set(id, { ...item, ...patch });
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.items.delete(id);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.items.clear();
    return Promise.resolve();
  }
}

export async function enqueue(store: OutboxStore, input: EnqueueInput): Promise<OutboxItem> {
  const parentId = input.dependsOn?.itemId;
  if (parentId !== undefined) {
    const mine = await store.list(input.userId);
    if (!mine.some((item) => item.id === parentId)) {
      throw new Error(`"${input.label}" depends on an item that is not waiting on this phone.`);
    }
  }
  return store.add({ ...input, state: "pending", attempts: 0, nextAttemptAt: 0, error: null });
}

export async function dueItems(store: OutboxStore, userId: string, now: number): Promise<OutboxItem[]> {
  const mine = await store.list(userId);
  return mine.filter((item) => item.state === "pending" && item.nextAttemptAt <= now);
}

export async function retry(store: OutboxStore, id: string): Promise<void> {
  await store.update(id, { state: "pending", nextAttemptAt: 0, error: null });
}

export async function pendingCount(store: OutboxStore, userId: string): Promise<number> {
  const mine = await store.list(userId);
  return mine.filter((item) => item.state === "pending").length;
}
