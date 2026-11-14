import test from "node:test";
import assert from "node:assert/strict";
import { MemoryKiranRepository } from "./memory-store.ts";
import { RpcError, type DeliveryOrderFull, type SalonWithApproval, type UserProfile } from "./types.ts";
import { INITIAL_SALONS, INITIAL_SKUS } from "../lib/data.ts";
import { buildDeliveryOrdersCsv } from "../lib/csv.ts";
import { buildLast30DaysDeliveryTrends } from "../lib/delivery-trends.ts";
import { resolveSalonCoordinates } from "../lib/karachi-geo.ts";
import { sortSalons } from "../lib/salon-sort.ts";
import { computeManagerQuickSnapshot } from "../lib/manager-snapshot.ts";
import { buildDeliveryMapStops, getDeliveryPinStyle } from "../lib/delivery-map-stops.ts";
import { checkOrderIntakeStock, DEFAULT_LOW_STOCK_THRESHOLD } from "../lib/order-stock.ts";
import {
  buildDeliveryReceiptPdfModel,
  createDeliveryReceiptPdfDocument,
} from "../lib/receipt-pdf.ts";
import { summarizeSelectedOrderCards } from "../lib/order-card-bulk.ts";
import { INITIAL_ROUTE } from "../lib/data.ts";
import {
  buildOfflineRouteSnapshot,
  buildTileUrl,
  computeRouteBounds,
  enumerateRouteTileCoords,
  isOfflineSnapshotExpired,
  MAX_ROUTE_CACHE_AGE_MS,
  projectLatLngToViewport,
  selectOptimalTileZoom,
} from "../lib/offline-map-cache.ts";
import {
  applyStoredRouteOrder,
  haversineDistanceKm,
  optimizeRouteStops,
} from "../lib/route-optimizer.ts";
import { filterOrderSkus } from "../lib/order-sku-search.ts";

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

test("sortSalons orders by Name (A-Z), Last Visited (recent first, unvisited last), and Outstanding Balance (highest first)", () => {
  const byName = sortSalons(INITIAL_SALONS, "name_asc");
  assert.deepEqual(
    byName.map((s) => s.name),
    [
      "Glamour Zone Tariq Road",
      "Karachi Looks Beauty Lounge",
      "Peng's Hair Studio DHA",
      "Saba's Herbal & Hair Care",
      "Toni&Guy Clifton Branch",
    ],
  );

  const byLastVisited = sortSalons(INITIAL_SALONS, "last_visited");
  assert.deepEqual(
    byLastVisited.map((s) => s.id),
    [
      "sal-gulshan-04", // 2026-11-09
      "sal-clifton-01", // 2026-11-08
      "sal-dha-02",     // 2026-11-07
      "sal-saddar-03",  // 2026-11-05
      "sal-tariq-05",   // null -> placed at bottom
    ],
  );

  const byBalance = sortSalons(INITIAL_SALONS, "balance_desc");
  assert.deepEqual(
    byBalance.map((s) => s.id),
    [
      "sal-clifton-01", // 45000
      "sal-dha-02",     // 28500
      "sal-saddar-03",  // 14000
      "sal-tariq-05",   // 0 (tie-broken alphabetically: Glamour Zone before Saba's)
      "sal-gulshan-04", // 0
    ],
  );
});

test("Order Intake Card optional notes persist on card, propagate to delivery order, and export in CSV", async () => {
  const repo = new MemoryKiranRepository();

  const cardWithNotes = await repo.executeRpc(repUser, "rep_create_card", {
    p_id: "crd-notes-1",
    p_salon_id: "sal-clifton-01",
    p_sku_id: "sku-krt-500",
    p_qty: 2,
    p_notes: "  Deliver before 2 PM to Madam Farida  ",
  });
  assert.equal(cardWithNotes.notes, "Deliver before 2 PM to Madam Farida");

  const cardWithoutNotes = await repo.executeRpc(repUser, "rep_create_card", {
    p_id: "crd-notes-2",
    p_salon_id: "sal-dha-02",
    p_sku_id: "sku-arg-100",
    p_qty: 1,
  });
  assert.equal(cardWithoutNotes.notes, null);

  const activityBefore = await repo.getSalonActivity("sal-clifton-01");
  assert.equal(activityBefore.orderCards[0]?.notes, "Deliver before 2 PM to Madam Farida");

  await repo.handleManagerApproval({ action: "approve_order_card", id: "crd-notes-1" });
  const overview = await repo.getManagerOverview(repUser);
  const converted = overview.deliveryOrders.find(
    (o) => o.salon_id === "sal-clifton-01" && o.notes === "Deliver before 2 PM to Madam Farida",
  );
  assert.ok(converted);

  const csv = buildDeliveryOrdersCsv([converted], overview.salons);
  const lines = csv.split("\r\n");
  assert.ok(lines[0]?.endsWith(",Delivery Notes"));
  assert.ok(lines[1]?.endsWith(",Deliver before 2 PM to Madam Farida"));
});

test("computeManagerQuickSnapshot aggregates pending deliveries and outstanding balances across all salons", async () => {
  const repo = new MemoryKiranRepository();
  const overview = await repo.getManagerOverview(repUser);

  const initialSnapshot = computeManagerQuickSnapshot(INITIAL_SALONS, overview.deliveryOrders);
  assert.equal(initialSnapshot.totalPendingDeliveries, 2);
  assert.equal(initialSnapshot.totalDeliveredCount, 0);
  assert.equal(initialSnapshot.pendingDeliveriesValuePkr, 33000);
  assert.equal(initialSnapshot.totalOutstandingBalancePkr, 87500);
  assert.equal(initialSnapshot.salonsWithBalanceCount, 3);
  assert.equal(initialSnapshot.totalSalonsCount, 5);

  await repo.handleManagerApproval({ action: "mark_delivery_delivered", id: "ord-8801" });
  const updatedOverview = await repo.getManagerOverview(repUser);
  const updatedSnapshot = computeManagerQuickSnapshot(updatedOverview.salons, updatedOverview.deliveryOrders);
  assert.equal(updatedSnapshot.totalPendingDeliveries, 1);
  assert.equal(updatedSnapshot.totalDeliveredCount, 1);
});

test("getDeliveryPinStyle distinguishes pending and delivered pins and buildDeliveryMapStops separates co-located orders", () => {
  const pendingStyle = getDeliveryPinStyle("pending_delivery", false);
  const deliveredStyle = getDeliveryPinStyle("delivered", false);
  const selectedPendingStyle = getDeliveryPinStyle("pending_delivery", true);
  const selectedDeliveredStyle = getDeliveryPinStyle("delivered", true);

  assert.notEqual(pendingStyle.background, deliveredStyle.background);
  assert.equal(pendingStyle.label, "Pending Delivery");
  assert.equal(deliveredStyle.label, "Delivered");
  assert.notEqual(selectedPendingStyle.background, pendingStyle.background);
  assert.notEqual(selectedDeliveredStyle.background, deliveredStyle.background);

  const orders: DeliveryOrderFull[] = [
    {
      id: "ord-p1",
      order_number: "ORD-P1",
      salon_id: "sal-clifton-01",
      salon_name: "Toni&Guy Clifton Branch",
      items: [{ sku_name: "Argan Serum", qty: 2, price: 1500 }],
      total_amount: 3000,
      status: "pending_delivery",
      delivered_at: null,
    },
    {
      id: "ord-d1",
      order_number: "ORD-D1",
      salon_id: "sal-clifton-01",
      salon_name: "Toni&Guy Clifton Branch",
      items: [{ sku_name: "Keratin 1L", qty: 1, price: 5000 }],
      total_amount: 5000,
      status: "delivered",
      delivered_at: "2026-11-12T10:00:00.000Z",
    },
    {
      id: "ord-p2",
      order_number: "ORD-P2",
      salon_id: "sal-dha-02",
      salon_name: "Peng's Hair Studio DHA",
      items: [{ sku_name: "Shampoo", qty: 4, price: 1000 }],
      total_amount: 4000,
      status: "pending_delivery",
      delivered_at: null,
    },
  ];

  const stops = buildDeliveryMapStops(orders, INITIAL_SALONS);
  assert.equal(stops.length, 3);
  assert.equal(stops[0]?.pendingStopNumber, 1);
  assert.equal(stops[1]?.pendingStopNumber, null);
  assert.equal(stops[2]?.pendingStopNumber, 2);

  // Co-located orders at sal-clifton-01 get distinct non-overlapping coordinates
  assert.notDeepEqual(stops[0]?.position, stops[1]?.position);
  assert.equal(
    Number((stops[1]!.position.lat - stops[0]!.position.lat).toFixed(6)),
    0.00045,
  );
});

test("checkOrderIntakeStock detects when requested SKU quantity exceeds current bag stock", () => {
  const keratinId = "sku-krt-500"; // bag_qty: 8

  const within = checkOrderIntakeStock(INITIAL_SKUS, keratinId, 5);
  assert.equal(within.availableStock, 8);
  assert.equal(within.exceedsStock, false);
  assert.equal(within.shortfall, 0);

  const exact = checkOrderIntakeStock(INITIAL_SKUS, keratinId, 8);
  assert.equal(exact.exceedsStock, false);
  assert.equal(exact.shortfall, 0);

  const exceeded = checkOrderIntakeStock(INITIAL_SKUS, keratinId, 11);
  assert.equal(exceeded.exceedsStock, true);
  assert.equal(exceeded.shortfall, 3);
  assert.equal(exceeded.unitLabel, "Bottles");

  const emptyStock = checkOrderIntakeStock(
    [{ ...INITIAL_SKUS[0]!, bag_qty: 0 }],
    keratinId,
    1,
  );
  assert.equal(emptyStock.availableStock, 0);
  assert.equal(emptyStock.exceedsStock, true);
  assert.equal(emptyStock.shortfall, 1);
  assert.equal(emptyStock.isOutOfStock, true);
  assert.equal(emptyStock.isLowStock, false);
  assert.equal(emptyStock.isBelowThreshold, true);

  // Predefined threshold checks (DEFAULT_LOW_STOCK_THRESHOLD = 7)
  assert.equal(DEFAULT_LOW_STOCK_THRESHOLD, 7);
  const atThreshold = checkOrderIntakeStock(
    [{ ...INITIAL_SKUS[0]!, bag_qty: DEFAULT_LOW_STOCK_THRESHOLD }],
    keratinId,
    1,
  );
  assert.equal(atThreshold.isLowStock, false);
  assert.equal(atThreshold.isBelowThreshold, false);

  const belowThreshold = checkOrderIntakeStock(INITIAL_SKUS, "sku-msk-500", 2); // bag_qty: 5
  assert.equal(belowThreshold.availableStock, 5);
  assert.equal(belowThreshold.exceedsStock, false);
  assert.equal(belowThreshold.isLowStock, true);
  assert.equal(belowThreshold.isBelowThreshold, true);
  assert.equal(belowThreshold.lowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD);
});

test("buildDeliveryReceiptPdfModel and createDeliveryReceiptPdfDocument build valid client-side PDF", () => {
  const order: DeliveryOrderFull = {
    id: "ord-pdf-1",
    order_number: "ORD/KRN 2026-9901",
    salon_id: "sal-clifton-01",
    salon_name: "Toni&Guy Clifton Branch",
    items: [
      { sku_name: "Kiran Brazilian Keratin Complex 500ml", qty: 2, price: 6800 },
      { sku_name: "Moroccan Argan Elixir Serum 100ml", qty: 4, price: 2450 },
    ],
    total_amount: 23400,
    status: "delivered",
    delivered_at: "2026-11-12T10:30:00.000Z",
    notes: "Leave parcel at reception desk with Ayesha.",
    signature_data: "data:image/png;base64,ABC...[sealed]",
  };
  const salon = INITIAL_SALONS.find((s) => s.id === "sal-clifton-01")!;

  const model = buildDeliveryReceiptPdfModel(order, salon);
  assert.equal(model.filename, "Kiran-Receipt-ORD-KRN-2026-9901.pdf");
  assert.equal(model.statusLabel, "Delivered");
  assert.equal(model.acknowledgementLabel, "Customer digital signature attached");
  assert.equal(model.invoiceTotalFormatted, "PKR 23,400");
  assert.equal(model.items.length, 2);
  assert.equal(model.items[0]?.lineTotalFormatted, "PKR 13,600");
  assert.equal(model.notes, "Leave parcel at reception desk with Ayesha.");

  const { doc } = createDeliveryReceiptPdfDocument(order, salon);
  const pdfOutput = doc.output("datauristring");
  assert.ok(pdfOutput.startsWith("data:application/pdf"));
  const rawPdf = doc.output();
  assert.ok(rawPdf.startsWith("%PDF-"));
});

test("summarizeSelectedOrderCards and bulk_process_order_cards support simultaneous approval and rejection", async () => {
  const repo = new MemoryKiranRepository();

  await repo.executeRpc(repUser, "rep_create_card", {
    p_id: "crd-bulk-1",
    p_salon_id: "sal-clifton-01",
    p_sku_id: "sku-krt-500",
    p_qty: 2,
    p_notes: "Morning drop-off",
  });
  await repo.executeRpc(repUser, "rep_create_card", {
    p_id: "crd-bulk-2",
    p_salon_id: "sal-dha-02",
    p_sku_id: "sku-arg-100",
    p_qty: 3,
  });
  await repo.executeRpc(repUser, "rep_create_card", {
    p_id: "crd-bulk-3",
    p_salon_id: "sal-gulshan-04",
    p_sku_id: "sku-shm-1000",
    p_qty: 1,
  });

  const before = await repo.getManagerOverview(repUser);
  const summary = summarizeSelectedOrderCards(before.pendingOrderCards, [
    "crd-bulk-1",
    "crd-bulk-2",
  ]);
  assert.equal(summary.selectedCount, 2);
  assert.equal(summary.totalUnits, 5);
  assert.equal(summary.totalAmountPkr, 2 * 6800 + 3 * 2450);
  assert.equal(summary.distinctSalonsCount, 2);

  // Bulk approve two cards at once
  const approveRes = await repo.handleManagerApproval({
    action: "bulk_process_order_cards",
    ids: ["crd-bulk-1", "crd-bulk-2"],
    decision: "approve",
  });
  assert.equal(approveRes.ok, true);
  assert.equal(approveRes.message, "2 order intake cards approved and converted to delivery.");

  const afterApprove = await repo.getManagerOverview(repUser);
  assert.equal(afterApprove.deliveryOrders.length, 4); // 2 initial + 2 bulk approved
  const ids = new Set(afterApprove.deliveryOrders.map((o) => o.id));
  const orderNumbers = new Set(afterApprove.deliveryOrders.map((o) => o.order_number));
  assert.equal(ids.size, 4);
  assert.equal(orderNumbers.size, 4);
  assert.ok(afterApprove.deliveryOrders.some((o) => o.notes === "Morning drop-off"));
  assert.equal(afterApprove.pendingOrderCards.some((c) => c.id === "crd-bulk-1"), false);
  assert.equal(afterApprove.pendingOrderCards.some((c) => c.id === "crd-bulk-2"), false);

  // Idempotent replay
  const replayRes = await repo.handleManagerApproval({
    action: "bulk_process_order_cards",
    ids: ["crd-bulk-1", "crd-bulk-2"],
    decision: "approve",
  });
  assert.equal(replayRes.ok, true);
  assert.equal(replayRes.message, "Selected order intake cards are already processed.");

  // Bulk reject remaining two pending cards (crd-seed-01 + crd-bulk-3)
  const rejectRes = await repo.handleManagerApproval({
    action: "bulk_process_order_cards",
    ids: ["crd-seed-01", "crd-bulk-3"],
    decision: "reject",
  });
  assert.equal(rejectRes.ok, true);
  assert.equal(rejectRes.message, "2 order intake cards declined.");

  const afterReject = await repo.getManagerOverview(repUser);
  assert.equal(afterReject.pendingOrderCards.length, 0);
  assert.equal(afterReject.deliveryOrders.length, 4); // unchanged by rejection
});

test("offline-map-cache computes route bounds, OSM tiles, viewport projection, and 30-day TTL", () => {
  const stops = buildDeliveryMapStops(
    [
      {
        id: "ord-1",
        order_number: "ORD-1",
        salon_id: "sal-clifton-01",
        salon_name: "Toni&Guy Clifton Branch",
        items: [{ sku_name: "Keratin", qty: 2, price: 6800 }],
        total_amount: 13600,
        status: "pending_delivery",
        delivered_at: null,
      },
      {
        id: "ord-2",
        order_number: "ORD-2",
        salon_id: "sal-dha-02",
        salon_name: "Peng's Hair Studio DHA",
        items: [{ sku_name: "Shampoo", qty: 1, price: 3200 }],
        total_amount: 3200,
        status: "delivered",
        delivered_at: "2026-11-12T10:00:00.000Z",
      },
    ],
    INITIAL_SALONS,
  );

  const bounds = computeRouteBounds(stops.map((s) => s.position));
  assert.ok(bounds.south < bounds.north);
  assert.ok(bounds.west < bounds.east);

  const zoom = selectOptimalTileZoom(bounds, 720, 380);
  assert.ok(zoom >= 10 && zoom <= 14);

  const tiles = enumerateRouteTileCoords(bounds, zoom, 1, 24);
  assert.ok(tiles.length > 0 && tiles.length <= 24);
  assert.match(buildTileUrl(tiles[0]!), /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);

  const projected = projectLatLngToViewport(
    stops[0]!.position.lat,
    stops[0]!.position.lng,
    bounds,
    zoom,
    720,
    380,
  );
  assert.ok(projected.x > 0 && projected.x < 720);
  assert.ok(projected.y > 0 && projected.y < 380);

  const now = new Date("2026-11-14T12:00:00.000Z");
  const snapshot = buildOfflineRouteSnapshot(stops, tiles.length, now);
  assert.equal(snapshot.stops.length, 2);
  assert.equal(snapshot.cachedTileCount, tiles.length);
  assert.equal(isOfflineSnapshotExpired(snapshot, now), false);
  assert.equal(
    isOfflineSnapshotExpired(snapshot, new Date(now.getTime() + MAX_ROUTE_CACHE_AGE_MS + 1000)),
    true,
  );
});

test("optimizeRouteStops reorders pending stops by shortest path from geolocation and preserves visited stops", () => {
  const saddarToCliftonKm = haversineDistanceKm(
    { lat: 24.8556, lng: 67.0261 },
    { lat: 24.8138, lng: 67.0299 },
  );
  assert.ok(saddarToCliftonKm > 3 && saddarToCliftonKm < 6);

  // Origin right next to DHA Phase 5 (sal-dha-02) should suggest DHA -> Clifton -> Tariq Road
  const proposal = optimizeRouteStops({
    route: INITIAL_ROUTE,
    salons: INITIAL_SALONS,
    origin: { lat: 24.7937, lng: 67.0644 },
    originSource: "gps",
    originLabel: "Current GPS",
  });

  assert.equal(proposal.hasChanges, true);
  assert.ok(proposal.savedKm > 0);
  assert.ok(proposal.optimizedPendingDistanceKm < proposal.originalPendingDistanceKm);
  assert.deepEqual(
    proposal.optimizedRoute.map((s) => s.id),
    ["stop-02", "stop-01", "stop-03"],
  );
  assert.deepEqual(
    proposal.optimizedRoute.map((s) => s.stop_number),
    [1, 2, 3],
  );

  // Preserves visited stops ahead of pending stops
  const withVisited = INITIAL_ROUTE.map((stop) =>
    stop.id === "stop-01" ? { ...stop, status: "visited" as const } : stop,
  );
  const partialProposal = optimizeRouteStops({
    route: withVisited,
    salons: INITIAL_SALONS,
    origin: { lat: 24.8716, lng: 67.0598 }, // near Tariq Road (stop-03)
    originSource: "gps",
    originLabel: "Current GPS",
  });
  assert.deepEqual(
    partialProposal.optimizedRoute.map((s) => s.id),
    ["stop-01", "stop-03", "stop-02"],
  );

  const restored = applyStoredRouteOrder(INITIAL_ROUTE, ["stop-02", "stop-01", "stop-03"]);
  assert.deepEqual(
    restored.map((s) => ({ id: s.id, num: s.stop_number })),
    [
      { id: "stop-02", num: 1 },
      { id: "stop-01", num: 2 },
      { id: "stop-03", num: 3 },
    ],
  );
});

test("filterOrderSkus matches products by name, category, SKU code, and multi-word queries", () => {
  assert.equal(filterOrderSkus(INITIAL_SKUS, "").length, INITIAL_SKUS.length);
  assert.equal(filterOrderSkus(INITIAL_SKUS, "   ").length, INITIAL_SKUS.length);

  const byCategory = filterOrderSkus(INITIAL_SKUS, "treatment");
  assert.equal(byCategory.length, 2);
  assert.ok(byCategory.every((s) => s.category === "Treatment"));

  const byName = filterOrderSkus(INITIAL_SKUS, "Argan");
  assert.equal(byName.length, 1);
  assert.equal(byName[0]?.id, "sku-arg-100");

  const byCode = filterOrderSkus(INITIAL_SKUS, "krn-clr");
  assert.equal(byCode.length, 1);
  assert.equal(byCode[0]?.id, "sku-clr-06");

  const multiToken = filterOrderSkus(INITIAL_SKUS, "treatment 500ml");
  assert.equal(multiToken.length, 1);
  assert.equal(multiToken[0]?.id, "sku-krt-500");

  assert.equal(filterOrderSkus(INITIAL_SKUS, "nonexistent-item").length, 0);
});





