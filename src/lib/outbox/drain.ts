import { classifyFailure, failureMessage } from "./classify";
import { dueItems } from "./queue";
import type { OutboxItem, OutboxStore } from "./types";

export type DrainReport = {
  sent: number;
  rejected: number;
  held: "none" | "auth" | "offline";
};

export type DrainDeps = {
  store: OutboxStore;
  userId: string;
  send: (fn: OutboxItem["fn"], args: Record<string, unknown>) => Promise<unknown>;
  now: () => number;
  lock: <T>(run: () => Promise<T>) => Promise<T | "busy">;
};

const MAX_STEPS_PER_PASS = 30;
const NOTHING_DONE: DrainReport = { sent: 0, rejected: 0, held: "none" };

// Exponential backoff with jitter: 2s, 4s, 8s, up to 60s
const backoffMs = (attempts: number): number => {
  const base = Math.min(60_000, 2_000 * Math.pow(2, Math.max(0, attempts)));
  return base + Math.floor(Math.random() * 500);
};

export async function drain(deps: DrainDeps): Promise<DrainReport> {
  const runPass = async (): Promise<DrainReport> => {
    let sent = 0;
    let rejected = 0;
    let held: DrainReport["held"] = "none";

    for (let step = 0; step < MAX_STEPS_PER_PASS; step++) {
      const due = await dueItems(deps.store, deps.userId, deps.now());
      if (due.length === 0) break;

      const head = due[0];

      // Handle dependencies
      if (head.dependsOn) {
        const mine = await deps.store.list(deps.userId);
        const parent = mine.find((it) => it.id === head.dependsOn?.itemId);
        if (parent?.state === "rejected") {
          await deps.store.update(head.id, {
            state: "rejected",
            error: `Parent "${parent.label}" was rejected.`,
          });
          rejected++;
          continue;
        }
      }

      try {
        await deps.send(head.fn, head.args);
        await deps.store.remove(head.id);
        sent++;
      } catch (err) {
        const failure = classifyFailure(err);
        if (failure === "auth") {
          held = "auth";
          break;
        }
        if (failure === "transient") {
          const nextAttemptAt = deps.now() + backoffMs(head.attempts);
          await deps.store.update(head.id, {
            attempts: head.attempts + 1,
            nextAttemptAt,
          });
          held = "offline";
          break;
        }
        // rejected
        await deps.store.update(head.id, {
          state: "rejected",
          error: failureMessage(err),
        });
        rejected++;
      }
    }

    return { sent, rejected, held };
  };

  const outcome = await deps.lock(runPass);
  return outcome === "busy" ? NOTHING_DONE : outcome;
}
