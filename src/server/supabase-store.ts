import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RouteStop, SKU } from "../lib/data.ts";
import type { OutboxFn } from "../lib/outbox/types.ts";
import {
  RpcError,
  type BootstrapPayload,
  type BulkSalonInput,
  type CreateShopOrderInput,
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

export class SupabaseKiranRepository implements KiranRepository {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private wrapDbError(error: { message: string; code?: string }): RpcError {
    if (error.code === "PGRST205" || error.code === "42P01" || error.message.includes("schema cache")) {
      return new RpcError(
        "Supabase tables are not initialized yet. Please run supabase/schema.sql in your Supabase SQL Editor and refresh.",
        503,
        "PGRST205",
      );
    }
    return new RpcError(error.message, 500, error.code ?? "XX000");
  }

  private mapShift(row: Record<string, unknown>): RepShift {
    return {
      id: String(row.id),
      repId: String(row.rep_id),
      repName: String(row.rep_name),
      status: row.status === "open" ? "open" : "closed",
      openingBagCount: Number(row.opening_bag_count ?? 0),
      closingBagCount: row.closing_bag_count !== null ? Number(row.closing_bag_count) : null,
      expectedBagCount: row.expected_bag_count !== null ? Number(row.expected_bag_count) : null,
      varianceUnits: Number(row.variance_units ?? 0),
      countRecordId: row.count_record_id ? String(row.count_record_id) : null,
      openedAt: String(row.opened_at),
      closedAt: row.closed_at ? String(row.closed_at) : null,
      approvalStatus: (row.approval_status as RepShift["approvalStatus"]) ?? "pending",
    };
  }

  private mapShopOrder(row: Record<string, unknown>): PublicShopOrder {
    return {
      id: String(row.id),
      orderNumber: String(row.order_number),
      productId: String(row.product_id),
      productName: String(row.product_name),
      shadeCode: String(row.shade_code),
      shadeVariant: String(row.shade_variant),
      qty: Number(row.qty),
      unitPricePkr: Number(row.unit_price_pkr),
      totalPkr: Number(row.total_pkr),
      customerName: String(row.customer_name),
      customerPhone: String(row.customer_phone),
      deliveryAddress: String(row.delivery_address),
      status: (row.status as PublicShopOrder["status"]) ?? "pending",
      createdAt: String(row.created_at),
    };
  }

  private async computeStats(user: UserProfile): Promise<RepMonthlyStats> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const sinceIso = startOfMonth.toISOString();

    const [visitsRes, paymentsRes, ordersRes, cardsRes] = await Promise.all([
      this.client.from("visits").select("id", { count: "exact", head: true }).gte("captured_at", sinceIso),
      this.client.from("payments").select("amount").gte("captured_at", sinceIso),
      this.client.from("delivery_orders").select("id", { count: "exact", head: true }),
      this.client.from("order_cards").select("id", { count: "exact", head: true }),
    ]);

    const cashCollectedPkr = (paymentsRes.data ?? []).reduce(
      (sum, r) => sum + Number((r as { amount?: number }).amount ?? 0),
      0,
    );

    const monthLabel = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(new Date()) + " Target";

    return {
      visitsCompleted: visitsRes.count ?? 0,
      visitsTarget: user.monthlyVisitTarget,
      cashCollectedPkr,
      ordersCount: (ordersRes.count ?? 0) + (cardsRes.count ?? 0),
      monthLabel,
    };
  }

  async getBootstrap(user: UserProfile): Promise<BootstrapPayload> {
    const [salonsRes, routeRes, skusRes, ordersRes, shiftRes, stats] = await Promise.all([
      this.client.from("salons").select("*").order("name"),
      this.client.from("route_stops").select("*").order("stop_number"),
      this.client.from("skus").select("*").order("name"),
      this.client.from("delivery_orders").select("*").order("created_at", { ascending: false }),
      this.client
        .from("rep_shifts")
        .select("*")
        .eq("rep_id", user.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.computeStats(user),
    ]);

    if (salonsRes.error) throw this.wrapDbError(salonsRes.error);

    const salons = (salonsRes.data ?? []) as SalonWithApproval[];
    const salonBalanceMap = new Map(salons.map((s) => [s.id, s.outstanding_balance]));
    const route = ((routeRes.data ?? []) as RouteStop[]).map((r) => ({
      ...r,
      balance: salonBalanceMap.get(r.salon_id) ?? r.balance,
    }));
    const skus = (skusRes.data ?? []) as SKU[];
    const orders = (ordersRes.data ?? []) as DeliveryOrderFull[];
    const activeShift = shiftRes.data ? this.mapShift(shiftRes.data as Record<string, unknown>) : null;
    const bagUnits = skus.reduce((sum, s) => sum + Number(s.bag_qty ?? 0), 0);

    return {
      profile: user,
      salons,
      route,
      skus,
      orders,
      activeShift,
      currentBagCount: activeShift ? activeShift.openingBagCount : bagUnits,
      stats,
      authMode: "supabase",
    };
  }

  async executeRpc(
    user: UserProfile,
    fn: OutboxFn,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = String(args.p_id ?? args.id ?? `${fn}-${Date.now()}`);
    const at = String(args.p_at_client ?? new Date().toISOString());

    switch (fn) {
      case "rep_check_in": {
        const bagCount = Number(args.p_bag_count ?? args.bag_count ?? 0);
        if (args.p_fail || args.fail || !Number.isFinite(bagCount) || bagCount < 0) {
          throw new RpcError(
            "Invalid check-in parameters. Bag stock count cannot be negative.",
            422,
            "22023",
          );
        }
        await this.client
          .from("rep_shifts")
          .update({ status: "closed", closed_at: at })
          .eq("rep_id", user.id)
          .eq("status", "open");

        const { error } = await this.client.from("rep_shifts").upsert(
          {
            id,
            rep_id: user.id,
            rep_name: user.fullName,
            status: "open",
            opening_bag_count: bagCount,
            expected_bag_count: bagCount,
            variance_units: 0,
            opened_at: at,
            approval_status: "pending",
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) throw new RpcError(error.message, 400, error.code ?? "23000");
        return { id, rep_day_id: id, status: "open", opening_bag_count: bagCount };
      }

      case "record_count": {
        const count = Number(args.p_count ?? 0);
        if (!Number.isFinite(count) || count < 0) {
          throw new RpcError("Invalid stock count. Must be zero or positive.", 422, "22023");
        }
        return { id, count, recorded_at: at };
      }

      case "rep_check_out": {
        const countId = typeof args.p_count_id === "string" ? args.p_count_id : null;
        const { data: openShift } = await this.client
          .from("rep_shifts")
          .select("*")
          .eq("rep_id", user.id)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: skus } = await this.client.from("skus").select("bag_qty");
        const bagSum = (skus ?? []).reduce((s, k) => s + Number((k as { bag_qty: number }).bag_qty), 0);
        const closingCount = typeof args.p_count === "number" ? args.p_count : bagSum;

        if (openShift) {
          const expected = Number(openShift.expected_bag_count ?? openShift.opening_bag_count ?? 0);
          const variance = closingCount - expected;
          await this.client
            .from("rep_shifts")
            .update({
              status: "closed",
              closing_bag_count: closingCount,
              count_record_id: countId,
              variance_units: variance,
              closed_at: at,
              approval_status: variance === 0 ? "approved" : "flagged",
            })
            .eq("id", openShift.id);
          return { id, status: "closed", closing_bag_count: closingCount, variance_units: variance };
        }
        return { id, status: "closed", closing_bag_count: closingCount, variance_units: 0 };
      }

      case "log_visit": {
        const salonId = String(args.p_salon_id ?? "");
        const notes = String(args.p_notes ?? "").trim();
        const lat = typeof args.p_lat === "number" ? args.p_lat : null;
        const lng = typeof args.p_lng === "number" ? args.p_lng : null;

        const { data: salon } = await this.client.from("salons").select("*").eq("id", salonId).maybeSingle();
        if (!salon) throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");

        const { data: existingVisit } = await this.client.from("visits").select("id").eq("id", id).maybeSingle();
        if (!existingVisit) {
          const { error } = await this.client.from("visits").insert({
            id,
            rep_id: user.id,
            salon_id: salonId,
            notes,
            lat,
            lng,
            captured_at: at,
          });
          if (error) throw new RpcError(error.message, 400, error.code ?? "23000");

          await this.client
            .from("salons")
            .update({
              last_visited_at: at,
              notes_count: Number(salon.notes_count ?? 0) + (notes ? 1 : 0),
            })
            .eq("id", salonId);

          await this.client.from("route_stops").update({ status: "visited" }).eq("salon_id", salonId);
        }
        return { id, salon_id: salonId, status: "completed", recorded_at: at };
      }

      case "add_salon_note": {
        const salonId = String(args.p_salon_id ?? "");
        const notes = String(args.p_notes ?? "").trim();
        const { data: salon } = await this.client.from("salons").select("notes_count").eq("id", salonId).maybeSingle();
        if (!salon) throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");

        await this.client.from("visits").upsert(
          { id, rep_id: user.id, salon_id: salonId, notes, captured_at: at },
          { onConflict: "id", ignoreDuplicates: true },
        );
        await this.client
          .from("salons")
          .update({ notes_count: Number(salon.notes_count ?? 0) + 1 })
          .eq("id", salonId);
        return { id, salon_id: salonId, noted: true };
      }

      case "create_salon": {
        const name = String(args.p_name ?? "").trim();
        if (!name) throw new RpcError("Salon name is required.", 422, "23502");
        const area = String(args.p_area ?? "Karachi").trim();
        const phone = String(args.p_phone ?? "0300-0000000").trim() || "0300-0000000";
        const contact = String(args.p_contact ?? "Owner").trim() || "Owner";

        const { error } = await this.client.from("salons").upsert(
          {
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
            created_by: user.id,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) throw new RpcError(error.message, 400, error.code ?? "23000");
        return { id, name, status: "prospect", approval_status: "pending_review" };
      }

      case "rep_record_payment": {
        const salonId = String(args.p_salon_id ?? "");
        const amount = Number(args.p_amount ?? 0);
        const method = String(args.p_method ?? "cash");
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new RpcError("Payment amount must be greater than zero.", 422, "22023");
        }
        const { data: salon } = await this.client.from("salons").select("*").eq("id", salonId).maybeSingle();
        if (!salon) throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");

        const { data: existingPay } = await this.client.from("payments").select("id").eq("id", id).maybeSingle();
        let remaining = Number(salon.outstanding_balance ?? 0);
        if (!existingPay) {
          const { error } = await this.client.from("payments").insert({
            id,
            rep_id: user.id,
            salon_id: salonId,
            amount,
            method,
            captured_at: at,
          });
          if (error) throw new RpcError(error.message, 400, error.code ?? "23000");
          remaining = Math.max(0, remaining - amount);
          await this.client.from("salons").update({ outstanding_balance: remaining }).eq("id", salonId);
          await this.client.from("route_stops").update({ balance: remaining }).eq("salon_id", salonId);
        }
        return { id, payment_id: id, amount, remaining_balance: remaining, status: "recorded" };
      }

      case "rep_create_card": {
        const salonId = String(args.p_salon_id ?? "");
        const skuId = String(args.p_sku_id ?? "");
        const qty = Number(args.p_qty ?? 1);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new RpcError("Order quantity must be positive.", 422, "22023");
        }
        const [{ data: salon }, { data: sku }] = await Promise.all([
          this.client.from("salons").select("id, open_cards_count").eq("id", salonId).maybeSingle(),
          this.client.from("skus").select("*").eq("id", skuId).maybeSingle(),
        ]);
        if (!salon) throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");
        if (!sku) throw new RpcError(`SKU '${skuId}' not found.`, 404, "P0002");

        const total = Number(sku.price) * qty;
        const { data: existingCard } = await this.client.from("order_cards").select("id").eq("id", id).maybeSingle();
        if (!existingCard) {
          const { error } = await this.client.from("order_cards").insert({
            id,
            rep_id: user.id,
            salon_id: salonId,
            sku_id: skuId,
            sku_name: sku.name,
            qty,
            total_amount: total,
            status: "pending_approval",
            captured_at: at,
          });
          if (error) throw new RpcError(error.message, 400, error.code ?? "23000");
          await this.client
            .from("salons")
            .update({ open_cards_count: Number(salon.open_cards_count ?? 0) + 1 })
            .eq("id", salonId);
        }
        return { id, salon_id: salonId, sku_id: skuId, qty, total_amount: total };
      }

      case "record_demand": {
        const skuName = String(args.p_sku_name ?? "").trim();
        const qty = Number(args.p_qty ?? 1);
        if (!skuName || !Number.isFinite(qty) || qty <= 0) {
          throw new RpcError("SKU name and positive quantity are required.", 422, "22023");
        }
        await this.client.from("lost_demand").upsert(
          { id, rep_id: user.id, sku_name: skuName, qty, captured_at: at },
          { onConflict: "id", ignoreDuplicates: true },
        );
        return { id, sku_name: skuName, qty };
      }

      case "rep_submit_delivery": {
        const orderId = String(args.p_order_id ?? "");
        const { data: order } = await this.client
          .from("delivery_orders")
          .select("*")
          .eq("id", orderId)
          .maybeSingle();
        if (!order) throw new RpcError(`Delivery order '${orderId}' not found.`, 404, "P0002");

        if (order.status !== "delivered") {
          await this.client
            .from("delivery_orders")
            .update({
              status: "delivered",
              delivery_submission_id: id,
              delivered_at: at,
            })
            .eq("id", orderId);

          const items = (order.items ?? []) as Array<{ sku_name: string; qty: number }>;
          for (const item of items) {
            const { data: sku } = await this.client
              .from("skus")
              .select("id, bag_qty")
              .eq("name", item.sku_name)
              .maybeSingle();
            if (sku) {
              await this.client
                .from("skus")
                .update({ bag_qty: Math.max(0, Number(sku.bag_qty) - item.qty) })
                .eq("id", sku.id);
            }
          }
        }
        return { id, submission_id: id, order_id: orderId, status: "delivered" };
      }

      case "rep_attach_signature": {
        const deliveryId = String(args.p_delivery_id ?? "");
        const signatureData = String(args.p_signature_data ?? "");
        if (!deliveryId || !signatureData) {
          throw new RpcError("Delivery ID and signature payload are required.", 422, "22023");
        }
        await this.client
          .from("delivery_orders")
          .update({ signature_data: signatureData })
          .eq("delivery_submission_id", deliveryId);
        return { id, delivery_id: deliveryId, attached: true };
      }
    }
  }

  async getSalonActivity(salonId: string): Promise<SalonActivityPayload> {
    const [{ data: salon }, { data: visits }, { data: payments }, { data: cards }] = await Promise.all([
      this.client.from("salons").select("*").eq("id", salonId).maybeSingle(),
      this.client.from("visits").select("*").eq("salon_id", salonId).order("captured_at", { ascending: false }),
      this.client.from("payments").select("*").eq("salon_id", salonId).order("captured_at", { ascending: false }),
      this.client.from("order_cards").select("*").eq("salon_id", salonId).order("captured_at", { ascending: false }),
    ]);

    if (!salon) throw new RpcError(`Salon '${salonId}' not found.`, 404, "P0002");

    return {
      salon: salon as SalonWithApproval,
      visits: (visits ?? []).map((v) => ({
        id: String(v.id),
        repId: String(v.rep_id),
        salonId: String(v.salon_id),
        notes: String(v.notes ?? ""),
        lat: v.lat !== null ? Number(v.lat) : null,
        lng: v.lng !== null ? Number(v.lng) : null,
        capturedAt: String(v.captured_at),
      })),
      payments: (payments ?? []).map((p) => ({
        id: String(p.id),
        repId: String(p.rep_id),
        salonId: String(p.salon_id),
        amount: Number(p.amount),
        method: String(p.method),
        capturedAt: String(p.captured_at),
      })),
      orderCards: (cards ?? []).map((c) => ({
        id: String(c.id),
        repId: String(c.rep_id),
        salonId: String(c.salon_id),
        skuId: String(c.sku_id),
        skuName: String(c.sku_name),
        qty: Number(c.qty),
        totalAmount: Number(c.total_amount),
        status: c.status as OrderCardRecord["status"],
        capturedAt: String(c.captured_at),
      })),
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
    const orderNumber = `KH-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
    const { data, error } = await this.client
      .from("public_shop_orders")
      .insert({
        id,
        order_number: orderNumber,
        product_id: input.productId,
        product_name: input.productName,
        shade_code: input.shadeCode,
        shade_variant: input.shadeVariant,
        qty,
        unit_price_pkr: input.unitPricePkr,
        total_pkr: input.unitPricePkr * qty,
        customer_name: input.customerName.trim(),
        customer_phone: input.customerPhone.trim(),
        delivery_address: input.deliveryAddress.trim(),
        status: "pending",
      })
      .select()
      .single();

    if (error || !data) {
      throw error ? this.wrapDbError(error) : new RpcError("Failed to create shop order.", 500, "XX000");
    }
    return this.mapShopOrder(data as Record<string, unknown>);
  }

  async listShopOrders(): Promise<PublicShopOrder[]> {
    const { data } = await this.client
      .from("public_shop_orders")
      .select("*")
      .order("created_at", { ascending: false });
    return (data ?? []).map((row) => this.mapShopOrder(row as Record<string, unknown>));
  }

  async getManagerOverview(user: UserProfile): Promise<ManagerOverviewPayload> {
    const [
      salonsRes,
      cardsRes,
      shiftsRes,
      paymentsRes,
      shopRes,
      deliveryRes,
      demandRes,
      skusRes,
      stats,
    ] = await Promise.all([
      this.client.from("salons").select("*").order("name"),
      this.client.from("order_cards").select("*").order("captured_at", { ascending: false }),
      this.client.from("rep_shifts").select("*").order("opened_at", { ascending: false }).limit(20),
      this.client.from("payments").select("*").order("captured_at", { ascending: false }).limit(25),
      this.client.from("public_shop_orders").select("*").order("created_at", { ascending: false }),
      this.client.from("delivery_orders").select("*").order("created_at", { ascending: false }),
      this.client.from("lost_demand").select("*").order("captured_at", { ascending: false }),
      this.client.from("skus").select("*").order("name"),
      this.computeStats(user),
    ]);

    const salons = (salonsRes.data ?? []) as SalonWithApproval[];
    const salonNames = new Map(salons.map((s) => [s.id, s.name]));

    return {
      pendingSalons: salons.filter((s) => s.approval_status === "pending_review"),
      pendingOrderCards: (cardsRes.data ?? [])
        .filter((c) => c.status === "pending_approval")
        .map((c) => ({
          id: String(c.id),
          repId: String(c.rep_id),
          salonId: String(c.salon_id),
          salonName: salonNames.get(String(c.salon_id)) ?? "Salon",
          skuId: String(c.sku_id),
          skuName: String(c.sku_name),
          qty: Number(c.qty),
          totalAmount: Number(c.total_amount),
          status: c.status as OrderCardRecord["status"],
          capturedAt: String(c.captured_at),
        })),
      shifts: (shiftsRes.data ?? []).map((s) => this.mapShift(s as Record<string, unknown>)),
      recentPayments: (paymentsRes.data ?? []).map((p) => ({
        id: String(p.id),
        repId: String(p.rep_id),
        salonId: String(p.salon_id),
        salonName: salonNames.get(String(p.salon_id)) ?? "Salon",
        amount: Number(p.amount),
        method: String(p.method),
        capturedAt: String(p.captured_at),
      })),
      salons,
      shopOrders: (shopRes.data ?? []).map((row) => this.mapShopOrder(row as Record<string, unknown>)),
      deliveryOrders: (deliveryRes.data ?? []) as DeliveryOrderFull[],
      lostDemand: (demandRes.data ?? []).map((d) => ({
        id: String(d.id),
        repId: String(d.rep_id),
        skuName: String(d.sku_name),
        qty: Number(d.qty),
        capturedAt: String(d.captured_at),
      })),
      skus: (skusRes.data ?? []) as SKU[],
      stats,
    };
  }

  async handleManagerApproval(input: ManagerApprovalAction): Promise<{ ok: true; message: string }> {
    switch (input.action) {
      case "approve_salon": {
        const { data: salon } = await this.client.from("salons").select("*").eq("id", input.id).maybeSingle();
        if (!salon) throw new RpcError("Salon not found.", 404, "P0002");
        const nextStage = input.stage ?? (salon.stage === "prospect" ? "trial" : salon.stage);
        await this.client
          .from("salons")
          .update({ approval_status: "approved", stage: nextStage })
          .eq("id", input.id);
        return { ok: true, message: `${salon.name} approved as ${String(nextStage).toUpperCase()}.` };
      }

      case "reject_salon": {
        await this.client.from("salons").update({ approval_status: "rejected" }).eq("id", input.id);
        return { ok: true, message: "Salon prospect marked rejected." };
      }

      case "approve_order_card": {
        const { data: card } = await this.client.from("order_cards").select("*").eq("id", input.id).maybeSingle();
        if (!card) throw new RpcError("Order intake card not found.", 404, "P0002");
        if (card.status === "approved") return { ok: true, message: "Order card already approved." };

        const [{ data: salon }, { data: sku }] = await Promise.all([
          this.client.from("salons").select("id, name, open_cards_count").eq("id", card.salon_id).maybeSingle(),
          this.client.from("skus").select("price").eq("id", card.sku_id).maybeSingle(),
        ]);

        await this.client.from("order_cards").update({ status: "approved" }).eq("id", input.id);
        if (salon) {
          await this.client
            .from("salons")
            .update({ open_cards_count: Math.max(0, Number(salon.open_cards_count ?? 1) - 1) })
            .eq("id", salon.id);
        }

        const orderNumber = `ORD-KRN-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
        await this.client.from("delivery_orders").insert({
          id: `ord-${Date.now()}`,
          order_number: orderNumber,
          salon_id: card.salon_id,
          salon_name: salon?.name ?? "Salon",
          items: [
            {
              sku_name: card.sku_name,
              qty: card.qty,
              price: Number(sku?.price ?? Math.round(Number(card.total_amount) / Math.max(1, Number(card.qty)))),
            },
          ],
          total_amount: card.total_amount,
          status: "pending_delivery",
        });

        return { ok: true, message: `Order card converted to delivery ${orderNumber}.` };
      }

      case "reject_order_card": {
        const { data: card } = await this.client.from("order_cards").select("salon_id").eq("id", input.id).maybeSingle();
        await this.client.from("order_cards").update({ status: "rejected" }).eq("id", input.id);
        if (card) {
          const { data: salon } = await this.client
            .from("salons")
            .select("open_cards_count")
            .eq("id", card.salon_id)
            .maybeSingle();
          if (salon) {
            await this.client
              .from("salons")
              .update({ open_cards_count: Math.max(0, Number(salon.open_cards_count ?? 1) - 1) })
              .eq("id", card.salon_id);
          }
        }
        return { ok: true, message: "Order intake card declined." };
      }

      case "approve_shift": {
        await this.client.from("rep_shifts").update({ approval_status: "approved" }).eq("id", input.id);
        return { ok: true, message: "Shift bag stock count approved." };
      }

      case "flag_shift": {
        await this.client.from("rep_shifts").update({ approval_status: "flagged" }).eq("id", input.id);
        return { ok: true, message: "Shift flagged for stock audit." };
      }

      case "update_shop_order_status": {
        await this.client.from("public_shop_orders").update({ status: input.status }).eq("id", input.id);
        return { ok: true, message: `Shop order updated to ${input.status}.` };
      }
    }
  }

  async bulkImportSalons(salons: BulkSalonInput[], createdBy: string): Promise<number> {
    const rows = salons
      .filter((s) => s.name?.trim())
      .map((s, idx) => ({
        id: `sal-imp-${Date.now()}-${idx + 1}`,
        name: s.name.trim(),
        area: (s.area || "Karachi").trim(),
        address: `${(s.area || "Karachi").trim()}, Karachi`,
        phone: (s.phone || "0300-0000000").trim(),
        contact_person: (s.contact || "Owner").trim(),
        stage: "prospect",
        approval_status: "approved",
        outstanding_balance: 0,
        credit_limit: Number(s.creditLimit) || 25000,
        created_by: createdBy,
      }));

    if (rows.length === 0) return 0;

    const { error } = await this.client.from("salons").upsert(rows, { onConflict: "name" });
    if (error) throw this.wrapDbError(error);
    return rows.length;
  }
}
