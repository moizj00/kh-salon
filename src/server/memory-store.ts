import { validateCatalogSkuInput, type CatalogSkuInput } from "../lib/catalog.ts";
import {
  INITIAL_ORDERS,
  INITIAL_ROUTE,
  INITIAL_SALONS,
  INITIAL_SKUS,
  type RouteStop,
  type SKU,
} from "../lib/data.ts";
import type { OutboxFn } from "../lib/outbox/types.ts";
import {
  RpcError,
  type BootstrapPayload,
  type BulkSalonInput,
  type CashLedgerEntry,
  type CreateShopOrderInput,
  type DeliveryNotificationResult,
  type DeliveryOrderFull,
  type KiranRepository,
  type LostDemandRecord,
  type ManagerApprovalAction,
  type ManagerOverviewPayload,
  type OrderCardRecord,
  type PaymentRecord,
  type PublicShopOrder,
  type RepMonthlyStats,
  type RepShift,
  type SalonActivityPayload,
  type SalonWithApproval,
  type UserProfile,
  type VisitRecord,
} from "./types.ts";

const clone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;

export class MemoryKiranRepository implements KiranRepository {
  private salons: SalonWithApproval[];
  private route: RouteStop[];
  private skus: SKU[];
  private orders: DeliveryOrderFull[];
  private shifts: RepShift[] = [];
  private counts = new Map<string, { id: string; repId: string; count: number; at: string }>();
  private visits: VisitRecord[] = [];
  private payments: PaymentRecord[] = [];
  private cashLedgerEntries: CashLedgerEntry[] = [];
  private orderCards: OrderCardRecord[] = [];
  private lostDemand: LostDemandRecord[] = [];
  private shopOrders: PublicShopOrder[] = [];
  private rpcResults = new Map<string, Record<string, unknown>>();

  constructor() {
    this.salons = INITIAL_SALONS.map((s) => ({
      ...s,
      approval_status: s.id === "sal-tariq-05" ? "pending_review" : "approved",
    }));
    this.route = clone(INITIAL_ROUTE);
    this.skus = clone(INITIAL_SKUS);
    this.orders = INITIAL_ORDERS.map((o, idx) => ({
      ...o,
      signature_data: null,
      created_at: idx === 0 ? "2026-11-10T10:00:00Z" : "2026-11-09T14:30:00Z",
    }));

    // Seed baseline monthly operational records so stats & manager views are grounded
    this.visits.push(
      {
        id: "vst-seed-01",
        repId: "rep-karachi-pilot-01",
        salonId: "sal-clifton-01",
        notes: "Reviewed keratin stock levels and display shelf placement.",
        lat: 24.8138,
        lng: 67.0299,
        capturedAt: "2026-11-08T09:30:00Z",
      },
      {
        id: "vst-seed-02",
        repId: "rep-karachi-pilot-01",
        salonId: "sal-dha-02",
        notes: "Stylist requested clarifying shampoo restock before weekend.",
        lat: 24.7937,
        lng: 67.0644,
        capturedAt: "2026-11-07T11:15:00Z",
      },
    );

    this.payments.push(
      {
        id: "pay-seed-01",
        repId: "mgr-karachi-hq-01",
        salonId: "sal-clifton-01",
        salonName: "Toni&Guy Clifton Branch",
        amount: 32000,
        method: "bank_transfer",
        bankName: "Meezan Bank",
        bankReference: "IBFT-884201",
        receiptNumber: "R-26-000001",
        recordedByName: "Tariq Mahmood (Office Manager)",
        recordedByRole: "manager",
        reversed: false,
        mayReverse: true,
        capturedAt: "2026-11-08T09:45:00Z",
      },
      {
        id: "pay-seed-02",
        repId: "mgr-karachi-hq-01",
        salonId: "sal-saddar-03",
        salonName: "Karachi Looks Beauty Lounge",
        amount: 18500,
        method: "cash",
        receiptNumber: "R-26-000002",
        recordedByName: "Tariq Mahmood (Office Manager)",
        recordedByRole: "manager",
        reversed: false,
        mayReverse: true,
        capturedAt: "2026-11-05T14:50:00Z",
      },
    );

    this.cashLedgerEntries.push(
      {
        id: "cle-seed-02",
        entryNumber: "CLE-2026-0002",
        entryType: "bank_transfer",
        amountPkr: 32000,
        balanceAfterPkr: 50500,
        referenceType: "payment",
        referenceId: "pay-seed-01",
        salonId: "sal-clifton-01",
        salonName: "Toni&Guy Clifton Branch",
        actorId: "mgr-karachi-hq-01",
        actorName: "Tariq Mahmood (Office Manager)",
        actorRole: "manager",
        status: "approved",
        bankName: "Meezan Bank",
        bankReference: "IBFT-884201",
        receiptNumber: "R-26-000001",
        notes: "Bank-to-Bank verified via Meezan Bank IBFT",
        createdAt: "2026-11-08T09:45:00Z",
      },
      {
        id: "cle-seed-01",
        entryNumber: "CLE-2026-0001",
        entryType: "settlement",
        amountPkr: 18500,
        balanceAfterPkr: 18500,
        referenceType: "payment",
        referenceId: "pay-seed-02",
        salonId: "sal-saddar-03",
        salonName: "Karachi Looks Beauty Lounge",
        actorId: "mgr-karachi-hq-01",
        actorName: "Tariq Mahmood (Office Manager)",
        actorRole: "manager",
        status: "approved",
        receiptNumber: "R-26-000002",
        notes: "Cash-to-Cash handover recorded at head office",
        createdAt: "2026-11-05T14:50:00Z",
      },
    );

    this.orderCards.push({
      id: "crd-seed-01",
      repId: "rep-karachi-pilot-01",
      salonId: "sal-saddar-03",
      salonName: "Karachi Looks Beauty Lounge",
      skuId: "sku-arg-100",
      skuName: "Moroccan Argan Elixir Serum 100ml",
      qty: 4,
      totalAmount: 9800,
      status: "pending_approval",
      capturedAt: "2026-11-11T12:20:00Z",
    });

    this.lostDemand.push({
      id: "dem-seed-01",
      repId: "rep-karachi-pilot-01",
      skuName: "Kiran Brazilian Keratin 1L",
      qty: 3,
      capturedAt: "2026-11-10T15:00:00Z",
    });
  }

  private computeMonthlyStats(user: UserProfile): RepMonthlyStats {
    const cashCollectedPkr = this.payments
      .filter((p) => !p.reversed)
      .reduce((acc, p) => acc + p.amount, 0);
    const visitsCompleted = this.visits.length;
    const ordersCount = this.orders.length + this.orderCards.length;
    return {
      visitsCompleted,
      visitsTarget: user.monthlyVisitTarget,
      cashCollectedPkr,
      ordersCount,
      monthLabel: "November 2026 Target",
    };
  }

  private getCurrentBagUnits(): number {
    return this.skus.reduce((sum, s) => sum + s.bag_qty, 0);
  }

  async getBootstrap(user: UserProfile): Promise<BootstrapPayload> {
    const activeShift =
      this.shifts.find((s) => s.repId === user.id && s.status === "open") ??
      this.shifts.find((s) => s.status === "open") ??
      null;

    return {
      profile: user,
      salons: clone(this.salons),
      route: clone(this.route),
      skus: clone(this.skus),
      orders: clone(this.orders),
      activeShift: activeShift ? clone(activeShift) : null,
      currentBagCount: activeShift ? activeShift.openingBagCount : this.getCurrentBagUnits(),
      stats: this.computeMonthlyStats(user),
      authMode: "demo",
    };
  }

  async executeRpc(
    user: UserProfile,
    fn: OutboxFn,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = String(args.p_id ?? args.id ?? `${fn}-${Date.now()}`);
    const cacheKey = `${fn}:${id}`;
    const existing = this.rpcResults.get(cacheKey);
    if (existing) {
      return clone(existing);
    }

    const at = String(args.p_at_client ?? new Date().toISOString());
    let result: Record<string, unknown>;

    switch (fn) {
      case "rep_check_in": {
        if (args.p_fail || args.fail) {
          throw new RpcError("Invalid check-in parameters.", 422, "22023");
        }
        const shift: RepShift = {
          id,
          repId: user.id,
          repName: user.fullName,
          status: "open",
          openingBagCount: 0,
          closingBagCount: null,
          expectedBagCount: 0,
          varianceUnits: 0,
          countRecordId: null,
          openedAt: at,
          closedAt: null,
          approvalStatus: "approved",
        };
        // Close any stale open shift for same rep first
        for (const s of this.shifts) {
          if (s.repId === user.id && s.status === "open") {
            s.status = "closed";
            s.closedAt = at;
          }
        }
        this.shifts.unshift(shift);
        result = { id, rep_day_id: id, status: "open", opening_bag_count: 0 };
        break;
      }

      case "record_count": {
        const count = Number(args.p_count ?? 0);
        if (!Number.isFinite(count) || count < 0) {
          throw new RpcError("Invalid count. Must be zero or positive.", 422, "22023");
        }
        this.counts.set(id, { id, repId: user.id, count, at });
        result = { id, count, recorded_at: at };
        break;
      }

      case "rep_check_out": {
        const openShift =
          this.shifts.find((s) => s.repId === user.id && s.status === "open") ??
          this.shifts.find((s) => s.status === "open");

        if (openShift) {
          openShift.status = "closed";
          openShift.closingBagCount = 0;
          openShift.countRecordId = null;
          openShift.varianceUnits = 0;
          openShift.closedAt = at;
          openShift.approvalStatus = "approved";
        }
        result = {
          id,
          status: "closed",
          closing_bag_count: 0,
          variance_units: 0,
        };
        break;
      }

      case "log_visit": {
        const salonId = String(args.p_salon_id ?? "");
        const salon = this.salons.find((s) => s.id === salonId);
        if (!salon) {
          throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");
        }
        const notes = String(args.p_notes ?? "").trim();
        const lat = typeof args.p_lat === "number" ? args.p_lat : null;
        const lng = typeof args.p_lng === "number" ? args.p_lng : null;

        this.visits.unshift({
          id,
          repId: user.id,
          salonId,
          notes,
          lat,
          lng,
          capturedAt: at,
        });

        salon.last_visited_at = at;
        if (notes) salon.notes_count += 1;

        for (const stop of this.route) {
          if (stop.salon_id === salonId) {
            stop.status = "visited";
          }
        }
        result = { id, salon_id: salonId, status: "completed", recorded_at: at };
        break;
      }

      case "add_salon_note": {
        const salonId = String(args.p_salon_id ?? "");
        const salon = this.salons.find((s) => s.id === salonId);
        if (!salon) {
          throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");
        }
        const notes = String(args.p_notes ?? "").trim();
        this.visits.unshift({
          id,
          repId: user.id,
          salonId,
          notes,
          lat: null,
          lng: null,
          capturedAt: at,
        });
        salon.notes_count += 1;
        result = { id, salon_id: salonId, noted: true };
        break;
      }

      case "create_salon": {
        const name = String(args.p_name ?? "").trim();
        if (!name) {
          throw new RpcError("Salon name is required.", 422, "23502");
        }
        const area = String(args.p_area ?? "Karachi").trim();
        const phone = String(args.p_phone ?? "0300-0000000").trim() || "0300-0000000";
        const contact = String(args.p_contact ?? "Owner").trim() || "Owner";

        const existingSalon = this.salons.find((s) => s.id === id);
        if (!existingSalon) {
          const created: SalonWithApproval = {
            id,
            name,
            area,
            address: `${area}, Karachi`,
            phone,
            contact_person: contact,
            stage: "prospect",
            approval_status: "pending_review",
            outstanding_balance: 0,
            credit_limit: 25000,
            last_visited_at: at,
            notes_count: 0,
            open_cards_count: 0,
          };
          this.salons.unshift(created);
        }
        result = { id, name, status: "prospect", approval_status: "pending_review" };
        break;
      }

      case "rep_record_payment": {
        throw new RpcError(
          "Field reps cannot collect or approve payments. Off-app Bank-to-Bank and Cash-to-Cash settlements must be recorded and marked paid by an Office Manager or Owner.",
          403,
          "42501",
        );
      }

      case "rep_create_card": {
        const salonId = String(args.p_salon_id ?? "");
        const skuId = String(args.p_sku_id ?? "");
        const qty = Number(args.p_qty ?? 1);
        const rawNotes = args.p_notes ?? args.notes ?? "";
        const notes = typeof rawNotes === "string" ? rawNotes.trim() || null : null;
        const salon = this.salons.find((s) => s.id === salonId);
        const sku = this.skus.find((k) => k.id === skuId);
        if (!salon) throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");
        if (!sku) throw new RpcError(`SKU '${skuId}' not found.`, 404, "P0002");
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new RpcError("Order quantity must be positive.", 422, "22023");
        }
        const total = sku.price * qty;
        this.orderCards.unshift({
          id,
          repId: user.id,
          salonId,
          salonName: salon.name,
          skuId,
          skuName: sku.name,
          qty,
          totalAmount: total,
          notes,
          status: "pending_approval",
          capturedAt: at,
        });
        salon.open_cards_count += 1;
        result = { id, salon_id: salonId, sku_id: skuId, qty, total_amount: total, notes };
        break;
      }

      case "record_demand": {
        const skuName = String(args.p_sku_name ?? "").trim();
        const qty = Number(args.p_qty ?? 1);
        if (!skuName || !Number.isFinite(qty) || qty <= 0) {
          throw new RpcError("SKU name and positive quantity are required.", 422, "22023");
        }
        this.lostDemand.unshift({
          id,
          repId: user.id,
          skuName,
          qty,
          capturedAt: at,
        });
        result = { id, sku_name: skuName, qty };
        break;
      }

      case "rep_submit_delivery": {
        const orderId = String(args.p_order_id ?? "");
        const order = this.orders.find((o) => o.id === orderId);
        if (!order) {
          throw new RpcError(`Delivery order '${orderId}' not found.`, 404, "P0002");
        }
        if (order.status !== "delivered") {
          order.status = "delivered";
          order.delivered_at = at;
          // Deduct delivered units from matching bag SKUs & expected shift stock
          let unitsDelivered = 0;
          for (const item of order.items) {
            unitsDelivered += item.qty;
            const sku = this.skus.find((k) => k.name === item.sku_name);
            if (sku) {
              sku.bag_qty = Math.max(0, sku.bag_qty - item.qty);
            }
          }
          const openShift = this.shifts.find((s) => s.repId === user.id && s.status === "open");
          if (openShift) {
            openShift.expectedBagCount = Math.max(
              0,
              (openShift.expectedBagCount ?? openShift.openingBagCount) - unitsDelivered,
            );
          }
        }
        result = { id, submission_id: id, order_id: orderId, status: "delivered" };
        break;
      }

      case "rep_attach_signature": {
        const deliveryId = String(args.p_delivery_id ?? "");
        const signatureData = String(args.p_signature_data ?? "");
        if (!deliveryId || !signatureData) {
          throw new RpcError("Delivery ID and signature payload are required.", 422, "22023");
        }
        // Locate delivery order by matching submission id or direct order id
        const subResult = [...this.rpcResults.entries()].find(
          ([k, v]) => k.startsWith("rep_submit_delivery:") && v.id === deliveryId,
        );
        const orderId = subResult ? String(subResult[1].order_id ?? "") : "";
        const order = this.orders.find((o) => o.id === orderId);
        if (order) {
          order.signature_data = signatureData;
        }
        result = { id, delivery_id: deliveryId, attached: true };
        break;
      }

      default:
        throw new RpcError(`Unknown RPC '${fn}'.`, 400, "42883");
    }

    this.rpcResults.set(cacheKey, result);
    return clone(result);
  }

  async getSalonActivity(salonId: string): Promise<SalonActivityPayload> {
    const salon = this.salons.find((s) => s.id === salonId);
    if (!salon) {
      throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");
    }
    const recentOrders = this.orders
      .filter((o) => o.salon_id === salonId)
      .sort((a, b) => {
        const tA = a.created_at ? Date.parse(a.created_at) : 0;
        const tB = b.created_at ? Date.parse(b.created_at) : 0;
        return tB - tA;
      })
      .slice(0, 5);

    return {
      salon: clone(salon),
      visits: clone(this.visits.filter((v) => v.salonId === salonId)),
      payments: clone(this.payments.filter((p) => p.salonId === salonId)),
      orderCards: clone(this.orderCards.filter((c) => c.salonId === salonId)),
      recentOrders: clone(recentOrders),
    };
  }

  async createShopOrder(input: CreateShopOrderInput): Promise<PublicShopOrder> {
    const qty = Number(input.qty);
    if (!input.customerName.trim() || !input.customerPhone.trim() || !input.deliveryAddress.trim()) {
      throw new RpcError("Customer name, phone, and delivery address are required.", 422, "23502");
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new RpcError("Quantity must be at least 1.", 422, "22023");
    }
    const id = `shp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const orderNumber = `KH-${new Date().getFullYear()}-${String(1000 + this.shopOrders.length + 1)}`;
    const record: PublicShopOrder = {
      id,
      orderNumber,
      productId: input.productId,
      productName: input.productName,
      shadeCode: input.shadeCode,
      shadeVariant: input.shadeVariant,
      qty,
      unitPricePkr: input.unitPricePkr,
      totalPkr: input.unitPricePkr * qty,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone.trim(),
      deliveryAddress: input.deliveryAddress.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.shopOrders.unshift(record);
    return clone(record);
  }

  async listShopOrders(): Promise<PublicShopOrder[]> {
    return clone(this.shopOrders);
  }

  async getManagerOverview(user: UserProfile): Promise<ManagerOverviewPayload> {
    return {
      pendingSalons: clone(this.salons.filter((s) => s.approval_status === "pending_review")),
      pendingOrderCards: clone(this.orderCards.filter((c) => c.status === "pending_approval")),
      shifts: clone(this.shifts),
      recentPayments: clone(this.payments),
      cashLedgerEntries: clone(this.cashLedgerEntries),
      salons: clone(this.salons),
      shopOrders: clone(this.shopOrders),
      deliveryOrders: clone(this.orders),
      lostDemand: clone(this.lostDemand),
      skus: clone(this.skus),
      stats: this.computeMonthlyStats(user),
    };
  }

  async handleManagerApproval(
    input: ManagerApprovalAction,
    actor?: UserProfile,
  ): Promise<{ ok: true; message: string }> {
    switch (input.action) {
      case "approve_salon": {
        const salon = this.salons.find((s) => s.id === input.id);
        if (!salon) throw new RpcError("Salon not found.", 404, "P0002");
        salon.approval_status = "approved";
        salon.stage = input.stage ?? (salon.stage === "prospect" ? "trial" : salon.stage);
        return { ok: true, message: `${salon.name} approved as ${salon.stage.toUpperCase()}.` };
      }

      case "reject_salon": {
        const salon = this.salons.find((s) => s.id === input.id);
        if (!salon) throw new RpcError("Salon not found.", 404, "P0002");
        salon.approval_status = "rejected";
        return { ok: true, message: `${salon.name} marked rejected.` };
      }

      case "approve_order_card": {
        const card = this.orderCards.find((c) => c.id === input.id);
        if (!card) throw new RpcError("Order intake card not found.", 404, "P0002");
        if (card.status === "approved") {
          return { ok: true, message: "Order card already approved." };
        }
        card.status = "approved";
        const salon = this.salons.find((s) => s.id === card.salonId);
        if (salon) {
          salon.open_cards_count = Math.max(0, salon.open_cards_count - 1);
        }
        const sku = this.skus.find((k) => k.id === card.skuId);
        const orderNumber = `ORD-KRN-2026-${8800 + this.orders.length + 1}`;
        this.orders.unshift({
          id: `ord-${Date.now()}`,
          order_number: orderNumber,
          salon_id: card.salonId,
          salon_name: card.salonName ?? salon?.name ?? "Salon",
          items: [
            {
              sku_name: card.skuName,
              qty: card.qty,
              price: sku?.price ?? Math.round(card.totalAmount / Math.max(1, card.qty)),
            },
          ],
          total_amount: card.totalAmount,
          status: "pending_delivery",
          delivered_at: null,
          notes: card.notes ?? null,
          signature_data: null,
          created_at: new Date().toISOString(),
        });
        return { ok: true, message: `Order card converted to delivery ${orderNumber}.` };
      }

      case "reject_order_card": {
        const card = this.orderCards.find((c) => c.id === input.id);
        if (!card) throw new RpcError("Order intake card not found.", 404, "P0002");
        card.status = "rejected";
        const salon = this.salons.find((s) => s.id === card.salonId);
        if (salon) {
          salon.open_cards_count = Math.max(0, salon.open_cards_count - 1);
        }
        return { ok: true, message: "Order intake card declined." };
      }

      case "bulk_process_order_cards": {
        const uniqueIds = Array.from(new Set(input.ids.filter((id) => typeof id === "string" && id.trim())));
        if (uniqueIds.length === 0) {
          throw new RpcError("Please select at least one order intake card.", 400, "22023");
        }
        const idSet = new Set(uniqueIds);
        const matchingCards = this.orderCards.filter((c) => idSet.has(c.id));
        if (matchingCards.length === 0) {
          throw new RpcError("Selected order intake cards were not found.", 404, "P0002");
        }
        const pendingCards = matchingCards.filter((c) => c.status === "pending_approval");
        if (pendingCards.length === 0) {
          return { ok: true, message: "Selected order intake cards are already processed." };
        }

        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        let processedCount = 0;

        for (let idx = 0; idx < pendingCards.length; idx++) {
          const card = pendingCards[idx];
          const salon = this.salons.find((s) => s.id === card.salonId);

          if (input.decision === "approve") {
            card.status = "approved";
            if (salon) {
              salon.open_cards_count = Math.max(0, salon.open_cards_count - 1);
            }
            const sku = this.skus.find((k) => k.id === card.skuId);
            const orderNumber = `ORD-KRN-2026-${8800 + this.orders.length + 1}`;
            this.orders.unshift({
              id: `ord-${nowMs}-${idx + 1}`,
              order_number: orderNumber,
              salon_id: card.salonId,
              salon_name: card.salonName ?? salon?.name ?? "Salon",
              items: [
                {
                  sku_name: card.skuName,
                  qty: card.qty,
                  price: sku?.price ?? Math.round(card.totalAmount / Math.max(1, card.qty)),
                },
              ],
              total_amount: card.totalAmount,
              status: "pending_delivery",
              delivered_at: null,
              notes: card.notes ?? null,
              signature_data: null,
              created_at: nowIso,
            });
          } else {
            card.status = "rejected";
            if (salon) {
              salon.open_cards_count = Math.max(0, salon.open_cards_count - 1);
            }
          }
          processedCount += 1;
        }

        return {
          ok: true,
          message:
            input.decision === "approve"
              ? `${processedCount} order intake ${processedCount === 1 ? "card" : "cards"} approved and converted to delivery.`
              : `${processedCount} order intake ${processedCount === 1 ? "card" : "cards"} declined.`,
        };
      }

      case "approve_shift": {
        const shift = this.shifts.find((s) => s.id === input.id);
        if (!shift) throw new RpcError("Shift record not found.", 404, "P0002");
        shift.approvalStatus = "approved";
        return { ok: true, message: "Shift check-in approved." };
      }

      case "flag_shift": {
        const shift = this.shifts.find((s) => s.id === input.id);
        if (!shift) throw new RpcError("Shift record not found.", 404, "P0002");
        shift.approvalStatus = "flagged";
        return { ok: true, message: "Shift flagged for review." };
      }

      case "update_shop_order_status": {
        const order = this.shopOrders.find((o) => o.id === input.id);
        if (!order) throw new RpcError("Shop order not found.", 404, "P0002");
        order.status = input.status;
        return { ok: true, message: `Order ${order.orderNumber} updated to ${input.status}.` };
      }

      case "mark_delivery_delivered": {
        const order = this.orders.find((o) => o.id === input.id);
        if (!order) throw new RpcError("Delivery order not found.", 404, "P0002");
        if (order.status === "delivered") {
          return { ok: true, message: `Order ${order.order_number} is already marked as delivered.` };
        }
        order.status = "delivered";
        order.delivered_at = new Date().toISOString();
        return { ok: true, message: `Order ${order.order_number} marked as delivered.` };
      }

      case "mark_deliveries_delivered": {
        const uniqueIds = Array.from(new Set(input.ids.filter((id) => typeof id === "string" && id.trim())));
        if (uniqueIds.length === 0) {
          throw new RpcError("No delivery order IDs provided.", 400, "22023");
        }
        const now = new Date().toISOString();
        let updatedCount = 0;
        let matchedCount = 0;
        for (const orderId of uniqueIds) {
          const order = this.orders.find((o) => o.id === orderId);
          if (!order) continue;
          matchedCount++;
          if (order.status !== "delivered") {
            order.status = "delivered";
            order.delivered_at = now;
            updatedCount++;
          }
        }
        if (matchedCount === 0) {
          throw new RpcError("No matching delivery orders found.", 404, "P0002");
        }
        if (updatedCount === 0) {
          return { ok: true, message: "Selected orders are already marked as delivered." };
        }
        return {
          ok: true,
          message:
            updatedCount === 1
              ? "1 order marked as delivered."
              : `${updatedCount} orders marked as delivered.`,
        };
      }

      case "record_office_payment": {
        if (actor && actor.role === "rep") {
          throw new RpcError(
            "Only an Office Manager or Owner can record and mark off-app payments as paid.",
            403,
            "42501",
          );
        }
        const salon = this.salons.find((s) => s.id === input.salonId);
        if (!salon) throw new RpcError("Salon not found.", 404, "P0002");
        const amount = Math.round(Number(input.amountPkr));
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new RpcError("Payment amount must be greater than zero PKR.", 422, "22023");
        }
        const method = input.method === "bank_transfer" ? "bank_transfer" : "cash";
        let bankName: string | null = null;
        let bankReference: string | null = null;
        if (method === "bank_transfer") {
          bankName = (input.bankName ?? "").trim();
          bankReference = (input.bankReference ?? "").trim();
          if (bankName.length < 2 || bankName.length > 60) {
            throw new RpcError("Bank name must be 2 to 60 characters for Bank-to-Bank transfers.", 422, "22023");
          }
          if (bankReference.length < 3 || bankReference.length > 60) {
            throw new RpcError("Bank reference / IBFT ID must be 3 to 60 characters.", 422, "22023");
          }
        }
        const seq = this.payments.length + 1;
        const paymentId = `pay-${Date.now()}-${seq}`;
        const receiptNumber = `R-26-${String(seq).padStart(6, "0")}`;
        const recordedAt = new Date().toISOString();
        const actorRole: UserProfile["role"] = actor?.role === "owner" ? "owner" : "manager";
        this.payments.unshift({
          id: paymentId,
          repId: actor?.id ?? "mgr-karachi-hq-01",
          salonId: salon.id,
          salonName: salon.name,
          amount,
          method,
          bankName,
          bankReference,
          receiptNumber,
          recordedByName: actor?.fullName ?? "Tariq Mahmood (Office Manager)",
          recordedByRole: actorRole,
          reversed: false,
          mayReverse: true,
          capturedAt: recordedAt,
        });

        const prevBalance = this.cashLedgerEntries.length > 0 ? this.cashLedgerEntries[0].balanceAfterPkr : 0;
        const newBalance = prevBalance + amount;
        this.cashLedgerEntries.unshift({
          id: `cle-${Date.now()}-${seq}`,
          entryNumber: `CLE-2026-${String(this.cashLedgerEntries.length + 1).padStart(4, "0")}`,
          entryType: method === "bank_transfer" ? "bank_transfer" : "settlement",
          amountPkr: amount,
          balanceAfterPkr: newBalance,
          referenceType: "payment",
          referenceId: paymentId,
          salonId: salon.id,
          salonName: salon.name,
          actorId: actor?.id ?? "mgr-karachi-hq-01",
          actorName: actor?.fullName ?? "Tariq Mahmood (Office Manager)",
          actorRole,
          status: "approved",
          bankName,
          bankReference,
          receiptNumber,
          notes:
            method === "bank_transfer"
              ? `Bank-to-Bank settlement via ${bankName} (${bankReference})`
              : "Cash-to-Cash settlement at office",
          createdAt: recordedAt,
        });

        salon.outstanding_balance = Math.max(0, salon.outstanding_balance - amount);
        for (const stop of this.route) {
          if (stop.salon_id === salon.id) {
            stop.balance = salon.outstanding_balance;
          }
        }
        return {
          ok: true,
          message:
            method === "bank_transfer"
              ? `Bank-to-Bank payment PKR ${amount.toLocaleString()} marked Paid (${receiptNumber}).`
              : `Cash-to-Cash settlement PKR ${amount.toLocaleString()} marked Paid (${receiptNumber}).`,
        };
      }

      case "reverse_office_payment": {
        if (actor && actor.role === "rep") {
          throw new RpcError("Only an Office Manager or Owner can reverse a recorded payment.", 403, "42501");
        }
        const reason = (input.reason ?? "").trim();
        if (reason.length < 5 || reason.length > 300) {
          throw new RpcError("Reversal reason must be between 5 and 300 characters.", 422, "22023");
        }
        const payment = this.payments.find((p) => p.id === input.paymentId);
        if (!payment) {
          throw new RpcError("Payment record not found.", 404, "P0002");
        }
        if (payment.reversed) {
          throw new RpcError("This payment is already reversed.", 409, "55000");
        }
        if (actor?.role === "manager" && payment.repId === actor.id) {
          throw new RpcError(
            "A manager cannot reverse a payment they recorded; the Owner can reverse it.",
            403,
            "42501",
          );
        }
        payment.reversed = true;
        payment.reversalReason = reason;
        payment.reversedAt = new Date().toISOString();
        payment.mayReverse = false;

        // Mark corresponding cash ledger entry as reversed and append reversal entry
        const matchedEntry = this.cashLedgerEntries.find((e) => e.referenceId === payment.id);
        if (matchedEntry) {
          matchedEntry.status = "reversed";
        }
        const prevBal = this.cashLedgerEntries.length > 0 ? this.cashLedgerEntries[0].balanceAfterPkr : 0;
        const newBal = Math.max(0, prevBal - payment.amount);
        this.cashLedgerEntries.unshift({
          id: `cle-rev-${Date.now()}`,
          entryNumber: `CLE-2026-${String(this.cashLedgerEntries.length + 1).padStart(4, "0")}`,
          entryType: "reversal",
          amountPkr: -payment.amount,
          balanceAfterPkr: newBal,
          referenceType: "reversal",
          referenceId: payment.id,
          salonId: payment.salonId,
          salonName: payment.salonName,
          actorId: actor?.id ?? "mgr-karachi-hq-01",
          actorName: actor?.fullName ?? "Office Manager",
          actorRole: actor?.role === "owner" ? "owner" : "manager",
          status: "reversed",
          bankName: payment.bankName,
          bankReference: payment.bankReference,
          receiptNumber: payment.receiptNumber,
          notes: `Reversed: ${reason}`,
          createdAt: new Date().toISOString(),
        });

        const salon = this.salons.find((s) => s.id === payment.salonId);
        if (salon) {
          salon.outstanding_balance += payment.amount;
          for (const stop of this.route) {
            if (stop.salon_id === salon.id) {
              stop.balance = salon.outstanding_balance;
            }
          }
        }
        return {
          ok: true,
          message: `Payment ${payment.receiptNumber || payment.id} reversed and salon balance restored.`,
        };
      }
    }
  }

  async notifyDelivery(orderId: string): Promise<DeliveryNotificationResult> {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) {
      throw new RpcError("Delivery order not found.", 404, "P0002");
    }
    const salon = this.salons.find((s) => s.id === order.salon_id);
    const recipientPhone = salon?.phone ?? "On-file contact";
    const notifiedAt = new Date().toISOString();
    return {
      ok: true,
      orderId: order.id,
      orderNumber: order.order_number,
      salonName: order.salon_name,
      recipientPhone,
      notifiedAt,
      message: `Notification resent for ${order.order_number} to ${order.salon_name} (${recipientPhone}).`,
    };
  }

  async bulkImportSalons(salons: BulkSalonInput[], _createdBy: string): Promise<number> {
    const at = new Date().toISOString();
    let imported = 0;
    for (const item of salons) {
      const name = (item.name || "").trim();
      if (!name) continue;
      const area = (item.area || "Karachi").trim();
      const phone = (item.phone || "0300-0000000").trim();
      const contact = (item.contact || "Owner").trim();
      const creditLimit = Number(item.creditLimit) || 25000;
      const id = `sal-imp-${Date.now()}-${imported + 1}`;

      const existing = this.salons.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.area = area;
        existing.phone = phone;
        existing.contact_person = contact;
        existing.credit_limit = creditLimit;
      } else {
        this.salons.push({
          id,
          name,
          area,
          address: `${area}, Karachi`,
          phone,
          contact_person: contact,
          stage: "prospect",
          approval_status: "approved",
          outstanding_balance: 0,
          credit_limit: creditLimit,
          last_visited_at: at,
          notes_count: 0,
          open_cards_count: 0,
        });
      }
      imported++;
    }
    return imported;
  }

  async upsertCatalogSku(input: CatalogSkuInput, existingId?: string): Promise<SKU> {
    const validated = validateCatalogSkuInput(input);
    if (validated.ok === false) {
      throw new RpcError(validated.error, 400, "22023");
    }
    const clean = validated.value;

    if (existingId) {
      const existing = this.skus.find((item) => item.id === existingId);
      if (!existing) {
        throw new RpcError("Product SKU not found.", 404, "P0002");
      }
      const duplicate = this.skus.find(
        (item) =>
          item.id !== existingId &&
          item.sku_code.toLowerCase() === clean.sku_code.toLowerCase(),
      );
      if (duplicate) {
        throw new RpcError(`SKU code ${clean.sku_code} is already assigned to another product.`, 409, "23505");
      }

      existing.sku_code = clean.sku_code;
      existing.name = clean.name;
      existing.category = clean.category;
      existing.price = clean.price;
      existing.bag_qty = clean.bag_qty;
      existing.unit = clean.unit;
      existing.brand = clean.brand;
      existing.product_type = clean.product_type;
      existing.volume_size = clean.volume_size;
      existing.recommended_use = clean.recommended_use;
      if (clean.image_key) {
        existing.image_key = clean.image_key;
      }
      return clone(existing);
    }

    const duplicate = this.skus.find(
      (item) => item.sku_code.toLowerCase() === clean.sku_code.toLowerCase(),
    );
    if (duplicate) {
      throw new RpcError(`SKU code ${clean.sku_code} already exists in catalog.`, 409, "23505");
    }

    const slug = clean.sku_code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const created: SKU = {
      id: `sku-${slug || Date.now()}-${this.skus.length + 1}`,
      sku_code: clean.sku_code,
      name: clean.name,
      category: clean.category,
      price: clean.price,
      bag_qty: clean.bag_qty,
      unit: clean.unit,
      brand: clean.brand,
      product_type: clean.product_type,
      volume_size: clean.volume_size,
      recommended_use: clean.recommended_use,
      image_key: clean.image_key,
    };
    this.skus.push(created);
    return clone(created);
  }

  async listCashLedgerEntries(): Promise<CashLedgerEntry[]> {
    return clone(this.cashLedgerEntries);
  }
}
