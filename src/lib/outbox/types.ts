// Kiran DMS — Rep's offline outbox types (P1-09, NFR-01)
// Every captured action is written to a queue on the phone first and sent through its app.* RPC.

export type Failure = "transient" | "auth" | "rejected";

export type OutboxFn =
  | "rep_check_in"
  | "record_count"
  | "rep_check_out"
  | "log_visit"
  | "add_salon_note"
  | "create_salon"
  | "rep_create_card"
  | "rep_record_payment"
  | "record_demand"
  | "rep_submit_delivery"
  | "rep_attach_signature";

export type Dependency = {
  itemId: string;
  argName: string;
};

export type OutboxItem = {
  id: string;
  seq: number;
  userId: string;
  fn: OutboxFn;
  args: Record<string, unknown>;
  label: string;
  salonId: string | null;
  capturedAt: string;
  dependsOn: Dependency | null;
  state: "pending" | "rejected";
  attempts: number;
  nextAttemptAt: number;
  error: string | null;
};

export type OutboxPatch = Partial<Pick<OutboxItem, "args" | "state" | "attempts" | "nextAttemptAt" | "error">>;

export interface OutboxStore {
  add(item: Omit<OutboxItem, "seq">): Promise<OutboxItem>;
  list(userId: string): Promise<OutboxItem[]>;
  update(id: string, patch: OutboxPatch): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}
