import test from "node:test";
import assert from "node:assert/strict";
import { MemoryKiranRepository } from "./memory-store.ts";
import { RpcError, type DeliveryOrderFull, type SalonWithApproval, type UserProfile } from "./types.ts";
import { buildDeliveryOrdersCsv } from "../lib/csv.ts";
import { buildLast30DaysDeliveryTrends } from "../lib/delivery-trends.ts";
import { resolveSalonCoordinates } from "../lib/karachi-geo.ts";

const repUser: UserProfile = {
  id: "rep-karachi-pilot-01",
  email: "rashid@kirancompany.pk",
  fullName: "Rashid Khan",
  role: "rep",
  territory: "Karachi Central",
  monthlyVisitTarget: 50,
};

test("rep check-in, negative count refusal, and dependent check-out variance", async () => {
  const repo = new MemoryKiranRepository();

  await assert.rejects(
    () => repo.executeRpc(repUser, "rep_check_in", { p_id: "bad-1", p_bag_count: -1, p_fail: true }),
    (err: unknown) => err instanceof RpcError && err.status === 422,
  );

  const checkIn = await repo.executeRpc(repUser, "rep_check_in", {
    p_id: "chk-1",
    p_bag_count: 24,
  });
  assert.equal(checkIn.id, "chk-1");

  // Idempotent replay returns same result without error
  const replay = await repo.executeRpc(repUser, "rep_check_in", {
    p_id: "chk-1",
    p_bag_count: 24,
  });
  assert.equal(replay.id, "chk-1");

  const count = await repo.executeRpc(repUser, "record_count", {
    p_id: "cnt-1",
    p_count: 22,
  });
  assert.equal(count.id, "cnt-1");

  const close = await repo.executeRpc(repUser, "rep_check_out", {
    p_id: "cls-1",
    p_count_id: count.id,
  });
  assert.equal(close.variance_units, -2);

  const overview = await repo.getManagerOverview(repUser);
  assert.equal(overview.shifts[0]?.approvalStatus, "flagged");
});

test("visit logging, cash payment balance update, and monthly stats aggregation", async () => {
  const repo = new MemoryKiranRepository();
  const before = await repo.getBootstrap(repUser);
  const cliftonBefore = before.salons.find((s) => s.id === "sal-clifton-01")!;

  await repo.executeRpc(repUser, "log_visit", {
    p_id: "vst-101",
    p_salon_id: "sal-clifton-01",
    p_notes: "Checked display shelf",
    p_lat: 24.81,
    p_lng: 67.03,
  });

  await repo.executeRpc(repUser, "rep_record_payment", {
    p_id: "pay-101",
    p_salon_id: "sal-clifton-01",
    p_amount: 15000,
  });

  const after = await repo.getBootstrap(repUser);
  const cliftonAfter = after.salons.find((s) => s.id === "sal-clifton-01")!;
  assert.equal(cliftonAfter.outstanding_balance, cliftonBefore.outstanding_balance - 15000);
  assert.equal(after.stats.visitsCompleted, before.stats.visitsCompleted + 1);
  assert.equal(after.stats.cashCollectedPkr, before.stats.cashCollectedPkr + 15000);
});

test("delivery submission and dependent signature attachment", async () => {
  const repo = new MemoryKiranRepository();

  const delivery = await repo.executeRpc(repUser, "rep_submit_delivery", {
    p_id: "del-99",
    p_order_id: "ord-8801",
  });
  assert.equal(delivery.id, "del-99");

  const sig = await repo.executeRpc(repUser, "rep_attach_signature", {
    p_id: "sig-99",
    p_delivery_id: delivery.id,
    p_signature_data: "data:image/png;base64,ABC",
  });
  assert.equal(sig.attached, true);

  const boot = await repo.getBootstrap(repUser);
  const ord = boot.orders.find((o) => o.id === "ord-8801")!;
  assert.equal(ord.status, "delivered");
  assert.equal(ord.signature_data, "data:image/png;base64,ABC");
});

test("public shop order creation and manager approval workflows", async () => {
  const repo = new MemoryKiranRepository();

  const shopOrder = await repo.createShopOrder({
    productId: "sp-musk-color",
    productName: "Musk Professional Hair Color Cream 60ml",
    shadeCode: "MUSK-6.1",
    shadeVariant: "Ash Brown 6.1",
    qty: 3,
    unitPricePkr: 850,
    customerName: "Ayesha Siddiqui",
    customerPhone: "0300-5551212",
    deliveryAddress: "Flat 4B, Clifton Block 2, Karachi",
  });
  assert.equal(shopOrder.totalPkr, 2550);
  assert.ok(shopOrder.orderNumber.startsWith("KH-"));

  await repo.handleManagerApproval({
    action: "update_shop_order_status",
    id: shopOrder.id,
    status: "confirmed",
  });

  await repo.handleManagerApproval({
    action: "approve_salon",
    id: "sal-tariq-05",
    stage: "regular",
  });

  await repo.handleManagerApproval({
    action: "approve_order_card",
    id: "crd-seed-01",
  });

  const overview = await repo.getManagerOverview(repUser);
  assert.equal(overview.shopOrders[0]?.status, "confirmed");
  assert.equal(overview.salons.find((s) => s.id === "sal-tariq-05")?.stage, "regular");
  assert.equal(overview.pendingOrderCards.length, 0);
  assert.equal(overview.deliveryOrders.length, 3);
});

test("bulk salon import parses and registers salon records with custom credit limits", async () => {
  const repo = new MemoryKiranRepository();
  const count = await repo.bulkImportSalons(
    [
      {
        name: "Luxe Beauty Bar",
        area: "DHA Phase 5",
        phone: "0301-8899001",
        contact: "Zara Ahmed",
        creditLimit: 60000,
      },
      {
        name: "Classic Cut Barbershop",
        area: "Gulshan Block 10",
        phone: "0322-1144778",
        contact: "Kashif Ali",
        creditLimit: 30000,
      },
    ],
    repUser.id,
  );

  assert.equal(count, 2);
  const overview = await repo.getManagerOverview(repUser);
  const luxe = overview.salons.find((s) => s.name === "Luxe Beauty Bar");
  assert.ok(luxe);
  assert.equal(luxe.area, "DHA Phase 5");
  assert.equal(luxe.credit_limit, 60000);
});

test("getSalonActivity returns at most the last 5 confirmed orders for the selected salon", async () => {
  const repo = new MemoryKiranRepository();

  // Create and approve 6 order cards for sal-clifton-01 (which already has 1 seeded order = 7 total)
  for (let i = 1; i <= 6; i++) {
    const cardId = `crd-recent-${i}`;
    await repo.executeRpc(repUser, "rep_create_card", {
      p_id: cardId,
      p_salon_id: "sal-clifton-01",
      p_sku_id: "sku-arg-100",
      p_qty: i,
    });
    await new Promise((r) => setTimeout(r, 5));
    await repo.handleManagerApproval({ action: "approve_order_card", id: cardId });
  }

  const activity = await repo.getSalonActivity("sal-clifton-01");
  assert.equal(activity.recentOrders.length, 5);
  assert.ok(activity.recentOrders.every((o) => o.salon_id === "sal-clifton-01"));
  // Verify descending order (newest first, i.e., qty 6 down to qty 2)
  assert.equal(activity.recentOrders[0]?.items[0]?.qty, 6);
  assert.equal(activity.recentOrders[4]?.items[0]?.qty, 2);
});

test("handleManagerApproval marks pending delivery as delivered and is idempotent", async () => {
  const repo = new MemoryKiranRepository();

  const res = await repo.handleManagerApproval({
    action: "mark_delivery_delivered",
    id: "ord-8801",
  });
  assert.equal(res.ok, true);

  const boot = await repo.getBootstrap(repUser);
  const ord = boot.orders.find((o) => o.id === "ord-8801")!;
  assert.equal(ord.status, "delivered");
  assert.ok(ord.delivered_at);

  const replay = await repo.handleManagerApproval({
    action: "mark_delivery_delivered",
    id: "ord-8801",
  });
  assert.equal(replay.ok, true);
});

test("notifyDelivery returns formatted notification payload with salon recipient phone", async () => {
  const repo = new MemoryKiranRepository();

  const res = await repo.notifyDelivery("ord-8801");
  assert.equal(res.ok, true);
  assert.equal(res.orderId, "ord-8801");
  assert.equal(res.orderNumber, "ORD-KRN-2026-8801");
  assert.equal(res.salonName, "Toni&Guy Clifton Branch");
  assert.equal(res.recipientPhone, "0300-8234190");
  assert.ok(res.message.includes("ORD-KRN-2026-8801"));
  assert.ok(res.message.includes("0300-8234190"));
});

test("handleManagerApproval marks multiple pending deliveries as delivered in one batch", async () => {
  const repo = new MemoryKiranRepository();

  const res = await repo.handleManagerApproval({
    action: "mark_deliveries_delivered",
    ids: ["ord-8801", "ord-8802"],
  });
  assert.equal(res.ok, true);
  assert.equal(res.message, "2 orders marked as delivered.");

  const boot = await repo.getBootstrap(repUser);
  assert.equal(boot.orders.find((o) => o.id === "ord-8801")?.status, "delivered");
  assert.equal(boot.orders.find((o) => o.id === "ord-8802")?.status, "delivered");

  const replay = await repo.handleManagerApproval({
    action: "mark_deliveries_delivered",
    ids: ["ord-8801", "ord-8802"],
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.message, "Selected orders are already marked as delivered.");
});

test("buildDeliveryOrdersCsv formats filtered deliveries with RFC 4180 escaping and totals", () => {
  const salons: SalonWithApproval[] = [
    {
      id: "sal-1",
      name: 'Glam, "Studio" Clifton',
      area: "Clifton Block 4",
      address: "Plot 12",
      phone: "0300-1112233",
      contact_person: "Sana",
      stage: "regular",
      approval_status: "approved",
      outstanding_balance: 0,
      credit_limit: 50000,
      last_visited_at: "2026-11-10T10:00:00.000Z",
      notes_count: 1,
      open_cards_count: 0,
    },
  ];
  const orders: DeliveryOrderFull[] = [
    {
      id: "ord-1",
      order_number: "ORD-1",
      salon_id: "sal-1",
      salon_name: 'Glam, "Studio" Clifton',
      items: [
        { sku_name: "Argan Serum", qty: 2, price: 1500 },
        { sku_name: "Keratin 1L", qty: 1, price: 5000 },
      ],
      total_amount: 8000,
      status: "delivered",
      delivered_at: "2026-11-12T12:00:00.000Z",
      signature_data: "data:image/png;base64,XYZ",
    },
    {
      id: "ord-2",
      order_number: "=SUM(A1:A2)",
      salon_id: "sal-missing",
      salon_name: "Test Salon",
      items: [{ sku_name: "Serum", qty: 3, price: 1000 }],
      total_amount: 3000,
      status: "pending_delivery",
      delivered_at: null,
    },
  ];

  const csv = buildDeliveryOrdersCsv(orders, salons);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0]?.startsWith("Order Number,Order ID,Salon Name"));
  assert.ok(lines[1]?.includes('"Glam, ""Studio"" Clifton"'));
  assert.ok(lines[1]?.includes("3,8000"));
  assert.ok(lines[1]?.includes("Digital Signature"));
  assert.ok(lines[2]?.startsWith("'=SUM(A1:A2)"));
});

test("buildLast30DaysDeliveryTrends produces 30 daily buckets and completion metrics", () => {
  const ref = new Date("2026-11-15T12:00:00.000Z");
  const sampleOrders: DeliveryOrderFull[] = [
    {
      id: "ord-d1",
      order_number: "ORD-D1",
      salon_id: "sal-1",
      salon_name: "Salon One",
      items: [],
      total_amount: 12000,
      status: "delivered",
      delivered_at: "2026-11-14T09:00:00.000Z",
    },
    {
      id: "ord-d2",
      order_number: "ORD-D2",
      salon_id: "sal-2",
      salon_name: "Salon Two",
      items: [],
      total_amount: 8000,
      status: "delivered",
      delivered_at: "2026-11-14T15:00:00.000Z",
    },
    {
      id: "ord-p1",
      order_number: "ORD-P1",
      salon_id: "sal-3",
      salon_name: "Salon Three",
      items: [],
      total_amount: 5000,
      status: "pending_delivery",
      delivered_at: null,
      created_at: "2026-11-15T08:00:00.000Z",
    },
  ];

  const summary = buildLast30DaysDeliveryTrends(sampleOrders, ref);
  assert.equal(summary.days.length, 30);
  assert.equal(summary.totalDelivered30d, 2);
  assert.equal(summary.totalPending30d, 1);
  assert.equal(summary.completionRatePct, 67);

  const nov14 = summary.days.find((d) => d.dateKey === "2026-11-14");
  assert.equal(nov14?.deliveredCount, 2);
  assert.equal(nov14?.completedRevenuePkr, 20000);

  const nov15 = summary.days.find((d) => d.dateKey === "2026-11-15");
  assert.equal(nov15?.pendingCount, 1);
});

test("resolveSalonCoordinates honors explicit coords and resolves Karachi zone fallbacks", () => {
  const explicit = resolveSalonCoordinates({
    id: "sal-explicit",
    name: "Custom",
    area: "DHA",
    address: "DHA",
    lat: 24.8012,
    lng: 67.0511,
  });
  assert.deepEqual(explicit, { lat: 24.8012, lng: 67.0511 });

  const inferred = resolveSalonCoordinates({
    id: "sal-gulshan",
    name: "Gulshan Salon",
    area: "Gulshan-e-Iqbal Block 7",
    address: "University Road, Karachi",
  });
  assert.ok(inferred.lat >= 24.7 && inferred.lat <= 25.1);
  assert.ok(inferred.lng >= 66.9 && inferred.lng <= 67.3);
});
