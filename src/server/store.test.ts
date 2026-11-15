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
import {
  canManageCatalog,
  filterCatalogSkus,
  validateCatalogSkuInput,
} from "../lib/catalog.ts";

import {
  deviceId,
  resetSupabaseClientForTests,
  resolveSupabaseConfig,
  rotateDeviceId,
} from "../lib/supabase.ts";
import {
  ensureUuid,
  mapCashLedgerRowsToEntries,
  mapCatalogueRowsToSkus,
  mapLiveSessionToUserProfile,
  mapOrderRowsToDeliveryOrders,
  mapOutboxFnToLiveRpc,
  mapPaymentRowsToRecords,
  mapRepDayRowsToShifts,
  mapRouteRowsToStops,
  mapSalonRowsToSalons,
  paisaToPkr,
  pkrToPaisa,
  SupabaseRpcError,
} from "../lib/supabase-kiran.ts";
import {
  computeSalonStockForecasts,
  filterSalonStockForecasts,
} from "../lib/salon-stock-forecast.ts";

const repUser: UserProfile = {
  id: "rep-karachi-pilot-01",
  email: "rashid@kirancompany.pk",
  fullName: "Rashid Khan",
  role: "rep",
  territory: "Karachi Central",
  monthlyVisitTarget: 50,
};

const managerUser: UserProfile = {
  id: "mgr-karachi-pilot-01",
  email: "sana@kirancompany.pk",
  fullName: "Sana Tariq",
  role: "manager",
  territory: "Karachi Operations",
  monthlyVisitTarget: 0,
};

const ownerUser: UserProfile = {
  id: "own-karachi-pilot-01",
  email: "owner@kirancompany.pk",
  fullName: "Bilal Raza",
  role: "owner",
  territory: "All Karachi Territories",
  monthlyVisitTarget: 0,
};

test("rep one-tap check-in, rep payment refusal (403), and daily close check-out", async () => {
  const repo = new MemoryKiranRepository();

  await assert.rejects(
    () =>
      repo.executeRpc(repUser, "rep_record_payment", {
        p_id: "bad-pay-1",
        p_salon_id: "sal-dha-02",
        p_amount: 5000,
      }),
    (err: unknown) => err instanceof RpcError && err.status === 403 && err.code === "42501",
  );

  await assert.rejects(
    () =>
      repo.executeRpc(repUser, "rep_check_in", {
        p_id: "bad-chk-1",
        p_fail: true,
      }),
    (err: unknown) => err instanceof RpcError && err.status === 422,
  );

  const checkIn = await repo.executeRpc(repUser, "rep_check_in", {
    p_id: "chk-1",
    p_counted: [],
  });
  assert.equal(checkIn.id, "chk-1");
  assert.equal(checkIn.status, "open");

  // Idempotent replay returns same result without error
  const replay = await repo.executeRpc(repUser, "rep_check_in", {
    p_id: "chk-1",
    p_counted: [],
  });
  assert.equal(replay.id, "chk-1");

  const close = await repo.executeRpc(repUser, "rep_check_out", {
    p_id: "cls-1",
  });
  assert.equal(close.status, "closed");
  assert.equal(close.variance_units, 0);

  const overview = await repo.getManagerOverview(managerUser);
  assert.equal(overview.shifts[0]?.status, "closed");
  assert.equal(overview.shifts[0]?.approvalStatus, "approved");
});

test("visit logging, Manager/Owner off-app Bank-to-Bank & Cash-to-Cash settlements, and audit reversal", async () => {
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

  // Bank-to-Bank requires valid bankName & bankReference
  await assert.rejects(
    () =>
      repo.handleManagerApproval(
        {
          action: "record_office_payment",
          salonId: "sal-clifton-01",
          method: "bank_transfer",
          amountPkr: 15000,
          bankName: "",
          bankReference: "",
        },
        managerUser,
      ),
    (err: unknown) => err instanceof RpcError && err.status === 422,
  );

  // Field Rep cannot record or approve office payments
  await assert.rejects(
    () =>
      repo.handleManagerApproval(
        {
          action: "record_office_payment",
          salonId: "sal-clifton-01",
          method: "cash",
          amountPkr: 5000,
        },
        repUser,
      ),
    (err: unknown) => err instanceof RpcError && err.status === 403,
  );

  // Manager notes Bank-to-Bank paid settlement
  const bankRes = await repo.handleManagerApproval(
    {
      action: "record_office_payment",
      salonId: "sal-clifton-01",
      method: "bank_transfer",
      amountPkr: 15000,
      bankName: "HBL Bank",
      bankReference: "IBFT-990123",
    },
    managerUser,
  );
  assert.equal(bankRes.ok, true);
  assert.match(bankRes.message, /R-26-/);

  const afterBank = await repo.getBootstrap(repUser);
  const cliftonAfter = afterBank.salons.find((s) => s.id === "sal-clifton-01")!;
  assert.equal(cliftonAfter.outstanding_balance, cliftonBefore.outstanding_balance - 15000);
  assert.equal(afterBank.route.find((r) => r.salon_id === "sal-clifton-01")?.balance, cliftonAfter.outstanding_balance);
  assert.equal(afterBank.stats.visitsCompleted, before.stats.visitsCompleted + 1);
  assert.equal(afterBank.stats.cashCollectedPkr, before.stats.cashCollectedPkr + 15000);

  const overviewAfterBank = await repo.getManagerOverview(managerUser);
  const recordedPay = overviewAfterBank.recentPayments.find((p) => p.bankReference === "IBFT-990123")!;
  assert.ok(recordedPay);
  assert.equal(recordedPay.bankName, "HBL Bank");
  assert.equal(recordedPay.recordedByName, "Sana Tariq");

  // Manager cannot reverse their own recorded settlement
  await assert.rejects(
    () =>
      repo.handleManagerApproval(
        {
          action: "reverse_office_payment",
          paymentId: recordedPay.id,
          reason: "Entered wrong bank ref",
        },
        managerUser,
      ),
    (err: unknown) => err instanceof RpcError && err.status === 403,
  );

  // Owner can reverse Manager's settlement with valid 5-300 char reason
  const revRes = await repo.handleManagerApproval(
    {
      action: "reverse_office_payment",
      paymentId: recordedPay.id,
      reason: "Reversed: duplicate IBFT entry verified",
    },
    ownerUser,
  );
  assert.equal(revRes.ok, true);

  const afterReverse = await repo.getBootstrap(repUser);
  const cliftonRestored = afterReverse.salons.find((s) => s.id === "sal-clifton-01")!;
  assert.equal(cliftonRestored.outstanding_balance, cliftonBefore.outstanding_balance);
  assert.equal(afterReverse.stats.cashCollectedPkr, before.stats.cashCollectedPkr);
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
  assert.equal(model.filename, "Lumex-Receipt-ORD-KRN-2026-9901.pdf");
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

test("filterOrderSkus matches products by name, category, brand, volume, SKU code, and multi-word queries", () => {
  assert.equal(filterOrderSkus(INITIAL_SKUS, "").length, INITIAL_SKUS.length);
  assert.equal(filterOrderSkus(INITIAL_SKUS, "   ").length, INITIAL_SKUS.length);

  const byTreatmentQuery = filterOrderSkus(INITIAL_SKUS, "treatment");
  const expectedTreatments = INITIAL_SKUS.filter((s) => s.category === "Treatment");
  assert.ok(expectedTreatments.every((t) => byTreatmentQuery.some((m) => m.id === t.id)));

  const byStyling = filterOrderSkus(INITIAL_SKUS, "Styling");
  const expectedStyling = INITIAL_SKUS.filter((s) => s.category === "Styling");
  assert.ok(expectedStyling.every((st) => byStyling.some((m) => m.id === st.id)));

  const byName = filterOrderSkus(INITIAL_SKUS, "KRN-ARG-100");
  assert.equal(byName.length, 1);
  assert.equal(byName[0]?.id, "sku-arg-100");

  const byCode = filterOrderSkus(INITIAL_SKUS, "krn-clr");
  assert.equal(byCode.length, 1);
  assert.equal(byCode[0]?.id, "sku-clr-06");

  const multiToken = filterOrderSkus(INITIAL_SKUS, "kiran keratin 500ml");
  assert.equal(multiToken.length, 1);
  assert.equal(multiToken[0]?.id, "sku-krt-500");

  const byBrandAndVolume = filterOrderSkus(INITIAL_SKUS, "Mocheqi 318ml");
  assert.equal(byBrandAndVolume.length, 1);
  assert.equal(byBrandAndVolume[0]?.id, "sku-msk-shampoo-318");

  assert.equal(filterOrderSkus(INITIAL_SKUS, "nonexistent-item").length, 0);
});

test("Lumex and Mocheqi Musk catalog supports brand/category search, role governance, and Owner/Manager SKU upsert", async () => {
  assert.equal(canManageCatalog("manager"), true);
  assert.equal(canManageCatalog("owner"), true);
  assert.equal(canManageCatalog("rep"), false);
  assert.equal(canManageCatalog(undefined), false);

  const lumexItems = filterCatalogSkus(INITIAL_SKUS, { brand: "Lumex" });
  assert.ok(lumexItems.length >= 4);
  assert.ok(lumexItems.every((s) => s.brand === "Lumex" && s.volume_size && s.product_type && s.recommended_use));

  const mocheqiItems = filterCatalogSkus(INITIAL_SKUS, { brand: "Mocheqi Musk" });
  assert.ok(mocheqiItems.length >= 4);
  assert.ok(mocheqiItems.every((s) => s.brand === "Mocheqi Musk" && s.price > 0));

  const useSearch = filterCatalogSkus(INITIAL_SKUS, {
    brand: "Lumex",
    query: "yellow brass blonde",
  });
  assert.equal(useSearch.length, 1);
  assert.equal(useSearch[0]?.id, "sku-lmx-toner-300");

  const invalid = validateCatalogSkuInput({
    sku_code: "LMX-TEST",
    name: "",
    category: "Treatment",
    price: 0,
    bag_qty: 2,
    unit: "Bottle",
    brand: "Lumex",
    product_type: "Keratin",
    volume_size: "500ml",
    recommended_use: "Apply evenly",
  });
  assert.equal(invalid.ok, false);

  const repo = new MemoryKiranRepository();
  const created = await repo.upsertCatalogSku({
    sku_code: "MSK-GNG-318",
    name: "Mocheqi Musk Ginger Anti-Hairfall Shampoo 318ml",
    category: "Shampoo",
    price: 2550,
    bag_qty: 9,
    unit: "Bottle",
    brand: "Mocheqi Musk",
    product_type: "Scalp Strengthening Shampoo",
    volume_size: "318ml",
    recommended_use: "Massage onto wet scalp for 3 minutes before conditioning mask.",
    image_key: "mocheqi-shampoo",
  });
  assert.equal(created.sku_code, "MSK-GNG-318");
  assert.equal(created.brand, "Mocheqi Musk");

  const updated = await repo.upsertCatalogSku(
    {
      sku_code: "MSK-GNG-318",
      name: "Mocheqi Musk Ginger Root Therapy Shampoo 318ml",
      category: "Shampoo",
      price: 2700,
      bag_qty: 11,
      unit: "Bottle",
      brand: "Mocheqi Musk",
      product_type: "Scalp Strengthening Shampoo",
      volume_size: "318ml",
      recommended_use: "Massage onto wet scalp for 3 minutes before conditioning mask.",
      image_key: "mocheqi-shampoo",
    },
    created.id,
  );
  assert.equal(updated.price, 2700);
  assert.equal(updated.bag_qty, 11);

  const boot = await repo.getBootstrap(repUser);
  const found = boot.skus.find((s) => s.id === created.id);
  assert.ok(found);
  assert.equal(found?.name, "Mocheqi Musk Ginger Root Therapy Shampoo 318ml");

  await assert.rejects(
    () =>
      repo.upsertCatalogSku({
        sku_code: "MSK-GNG-318",
        name: "Duplicate SKU",
        category: "Shampoo",
        price: 1000,
        bag_qty: 1,
        unit: "Bottle",
        brand: "Mocheqi Musk",
        product_type: "Shampoo",
        volume_size: "318ml",
        recommended_use: "Rinse",
      }),
    RpcError,
  );
});

test("supabase.ts resolves config from env vars and handles Node deviceId safely", async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  resetSupabaseClientForTests();

  process.env.SUPABASE_URL = "https://example-kiran.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-public-key-123";
  try {
    const cfg = await resolveSupabaseConfig();
    assert.equal(cfg.supabaseUrl, "https://example-kiran.supabase.co");
    assert.equal(cfg.supabaseAnonKey, "anon-public-key-123");
    assert.equal(deviceId(), "web-server");
    assert.equal(rotateDeviceId("web-old"), "web-server");
  } finally {
    resetSupabaseClientForTests();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = prevKey;
  }
});

test("supabase-kiran.ts enforces off-app payment governance, MFA flag, and maps normalized 63-table rows", () => {
  assert.equal(pkrToPaisa(2450), 245000);
  assert.equal(paisaToPkr(245000), 2450);

  const validUuid = "11111111-2222-4333-8444-555555555555";
  const orderUuid = "22222222-3333-4444-8555-666666666666";
  const paymentUuid = "33333333-4444-4555-8666-777777777777";
  assert.equal(ensureUuid(validUuid), validUuid);
  assert.match(ensureUuid("non-uuid"), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  const checkInRpc = mapOutboxFnToLiveRpc("rep_check_in", {
    p_id: "chk-1",
    p_lat: 24.81,
    p_lng: 67.03,
    p_at_client: "2026-11-16T08:00:00Z",
  });
  assert.equal(checkInRpc.rpcName, "rep_check_in");
  assert.deepEqual(checkInRpc.rpcArgs.p_counted, []);
  assert.equal("p_bag_count" in checkInRpc.rpcArgs, false);

  assert.throws(
    () =>
      mapOutboxFnToLiveRpc("rep_record_payment", {
        p_id: validUuid,
        p_salon_id: validUuid,
        p_amount: 15000,
        p_method: "cash",
      }),
    (err: unknown) => err instanceof SupabaseRpcError && err.status === 403 && err.code === "42501",
  );

  const cardRpc = mapOutboxFnToLiveRpc("rep_create_card", {
    p_id: validUuid,
    p_salon_id: validUuid,
    p_sku_id: validUuid,
    p_sku_name: "Lumex Keratin Mask 500ml",
    p_qty: 3,
  });
  assert.equal(cardRpc.rpcName, "rep_create_card");
  assert.equal(cardRpc.rpcArgs.p_body, "Lumex Keratin Mask 500ml × 3");
  assert.deepEqual(cardRpc.rpcArgs.p_lines, [{ sku_id: validUuid, qty: 3 }]);

  const ownerAal1 = mapLiveSessionToUserProfile(
    {
      user_id: validUuid,
      full_name: "Bilal Raza",
      role: "owner",
      status: "active",
      device_status: "approved",
    },
    { id: validUuid, email: "owner@kirancompany.pk" },
    "Karachi South",
    "aal1",
  );
  assert.equal(ownerAal1.role, "owner");
  assert.equal(ownerAal1.deviceStatus, "approved");
  assert.equal(ownerAal1.mfaRequired, true);

  const ownerAal2 = mapLiveSessionToUserProfile(
    { user_id: validUuid, full_name: "Bilal Raza", role: "owner", status: "active" },
    { id: validUuid, email: "owner@kirancompany.pk" },
    "Karachi South",
    "aal2",
  );
  assert.equal(ownerAal2.mfaRequired, false);

  const mappedSkus = mapCatalogueRowsToSkus(
    [
      {
        product_id: validUuid,
        product_group_id: validUuid,
        group_name: "Treatment",
        brand_label: "Lumex",
        name: "Lumex Repair Mask",
        description: "Post-color mask",
        skus: [
          {
            id: validUuid,
            code: "LMX-MSK-500",
            variant: "500ml",
            unit: "ml",
            size_value: 500,
            list_price_paisa: 390000,
            active: true,
          },
        ],
      },
    ],
    [{ sku_id: validUuid, available: 14 }],
  );
  assert.equal(mappedSkus.length, 1);
  assert.equal(mappedSkus[0]?.price, 3900);
  assert.equal(mappedSkus[0]?.bag_qty, 14);
  assert.equal(mappedSkus[0]?.category, "Treatment");

  // Normalized salon + area + salon_contact + salon_credit + office_receivables_ageing
  const receivables = new Map([[validUuid, 1850000]]);
  const mappedSalons = mapSalonRowsToSalons(
    [
      {
        id: validUuid,
        name: "Salon Royale",
        area: { name: "DHA Phase 6" },
        stage: "vip",
        verification_status: "pending",
        salon_contact: [
          { name: "Old Contact", phone: "0300-0000000", is_primary: false, active: false },
          { name: "Farida Khan", phone: "0300-8234190", is_primary: true, active: true },
        ],
        salon_credit: { credit_limit_paisa: 7500000 },
      },
    ],
    receivables,
  );
  assert.equal(mappedSalons[0]?.area, "DHA Phase 6");
  assert.equal(mappedSalons[0]?.contact_person, "Farida Khan");
  assert.equal(mappedSalons[0]?.phone, "0300-8234190");
  assert.equal(mappedSalons[0]?.credit_limit, 75000);
  assert.equal(mappedSalons[0]?.outstanding_balance, 18500);
  assert.equal(mappedSalons[0]?.approval_status, "pending_review");

  const stops = mapRouteRowsToStops(
    [{ stop_id: validUuid, sequence: 1, salon_id: validUuid, reason: "payment", visited: false }],
    mappedSalons,
  );
  assert.equal(stops[0]?.due_reason, "payment_due");
  assert.equal(stops[0]?.balance, 18500);

  // Normalized sales_order + sales_order_line + delivery + delivery_signature hydration
  const mappedOrders = mapOrderRowsToDeliveryOrders(
    [
      {
        id: orderUuid,
        order_number: "SO-26-000010",
        salon_id: validUuid,
        total_paisa: 960000,
        status: "confirmed",
        created_at: "2026-11-15T10:00:00Z",
      },
    ],
    new Map([[validUuid, "Salon Royale"]]),
    {
      linesByOrderId: new Map([
        [orderUuid, [{ sku_name: "Lumex Repair Mask 500ml", qty: 2, price: 4800 }]],
      ]),
      deliveriesByOrderId: new Map([
        [orderUuid, { status: "delivered", delivered_at: "2026-11-15T14:00:00Z" }],
      ]),
      signaturesByOrderId: new Map([[orderUuid, "signed:Farida Khan"]]),
    },
  );
  assert.equal(mappedOrders[0]?.status, "delivered");
  assert.equal(mappedOrders[0]?.items[0]?.sku_name, "Lumex Repair Mask 500ml");
  assert.equal(mappedOrders[0]?.signature_data, "signed:Farida Khan");

  // Disambiguated rep_day -> user_profile!rep_day_rep_id_fkey mapping
  const shifts = mapRepDayRowsToShifts([
    {
      id: "shift-1",
      rep_id: "rep-1",
      status: "open",
      check_in_at: "2026-11-15T08:00:00Z",
      user_profile: { full_name: "Rashid Khan" },
    },
  ]);
  assert.equal(shifts[0]?.repName, "Rashid Khan");

  // Payment + receipt + payment_reversal + mayReverse enforcement
  const payments = mapPaymentRowsToRecords(
    [
      {
        id: paymentUuid,
        salon_id: validUuid,
        recorded_by: managerUser.id,
        amount_paisa: 1500000,
        method: "bank_transfer",
        bank_name: "Meezan Bank",
        bank_reference: "IBFT-12345",
        recorded_at: "2026-11-15T12:00:00Z",
      },
    ],
    new Map([[validUuid, "Salon Royale"]]),
    new Map([[paymentUuid, "R-26-000009"]]),
    new Map(),
    new Map([[managerUser.id, "Sana Tariq"]]),
    managerUser,
  );
  assert.equal(payments[0]?.receiptNumber, "R-26-000009");
  assert.equal(payments[0]?.amount, 15000);
  assert.equal(payments[0]?.bankName, "Meezan Bank");
  assert.equal(payments[0]?.mayReverse, false); // manager cannot reverse self-recorded payment
});

test("Manager cash ledger tracks append-only entries, running balance, and reversals", async () => {
  const repo = new MemoryKiranRepository();

  const initialEntries = await repo.listCashLedgerEntries();
  assert.ok(initialEntries.length >= 2, "Expected initial seeded cash ledger entries");
  const baselineBal = initialEntries[0].balanceAfterPkr;
  assert.ok(baselineBal > 0);

  // Manager records Bank-to-Bank settlement
  const payRes = await repo.handleManagerApproval(
    {
      action: "record_office_payment",
      salonId: "sal-clifton-01",
      method: "bank_transfer",
      amountPkr: 12000,
      bankName: "Habib Bank Limited",
      bankReference: "HBL-IBFT-772910",
    },
    managerUser,
  );
  assert.ok(payRes.ok);

  const updatedEntries = await repo.listCashLedgerEntries();
  const latestEntry = updatedEntries[0];
  assert.equal(latestEntry.entryType, "bank_transfer");
  assert.equal(latestEntry.amountPkr, 12000);
  assert.equal(latestEntry.bankName, "Habib Bank Limited");
  assert.equal(latestEntry.bankReference, "HBL-IBFT-772910");
  assert.equal(latestEntry.balanceAfterPkr, baselineBal + 12000);
  assert.equal(latestEntry.status, "approved");

  // Owner reverses the payment with reason
  const overview = await repo.getManagerOverview(ownerUser);
  const targetPayment = overview.recentPayments[0];
  assert.ok(targetPayment);

  const revRes = await repo.handleManagerApproval(
    {
      action: "reverse_office_payment",
      paymentId: targetPayment.id,
      reason: "Cheque / IBFT mismatch verification reversal",
    },
    ownerUser,
  );
  assert.ok(revRes.ok);

  const entriesAfterRev = await repo.listCashLedgerEntries();
  const revEntry = entriesAfterRev[0];
  assert.equal(revEntry.entryType, "reversal");
  assert.equal(revEntry.amountPkr, -12000);
  assert.equal(revEntry.balanceAfterPkr, baselineBal);
  assert.equal(revEntry.status, "reversed");

  // Test raw Supabase mapper mapCashLedgerRowsToEntries
  const mapped = mapCashLedgerRowsToEntries(
    [
      {
        id: "cle-raw-1",
        entry_number: "CLE-2026-9001",
        entry_type: "bank_transfer",
        amount_paisa: 2500000,
        balance_after_paisa: 7550000,
        reference_type: "payment",
        reference_id: "pay-raw-1",
        salon_id: "sal-raw-1",
        actor_id: managerUser.id,
        status: "approved",
        bank_name: "Standard Chartered",
        bank_reference: "SCB-99882",
        receipt_number: "R-26-000888",
        created_at: "2026-11-15T10:00:00Z",
      },
    ],
    new Map([["sal-raw-1", "Peng's Studio"]]),
    new Map([[managerUser.id, "Sana Tariq"]]),
  );

  assert.equal(mapped[0]?.entryNumber, "CLE-2026-9001");
  assert.equal(mapped[0]?.amountPkr, 25000);
  assert.equal(mapped[0]?.balanceAfterPkr, 75500);
  assert.equal(mapped[0]?.salonName, "Peng's Studio");
  assert.equal(mapped[0]?.actorName, "Sana Tariq");
});

test("Client salon stock forecasting alerts manager proactively on cadence and depletion", () => {
  const salons: SalonWithApproval[] = [
    {
      id: "sal-clifton-01",
      name: "Toni&Guy Clifton Branch",
      area: "Clifton Block 4",
      address: "Zamzama Lane",
      phone: "0300-8234190",
      contact_person: "Rashid Ali",
      stage: "vip",
      outstanding_balance: 45000,
      credit_limit: 150000,
      last_visited_at: "2026-11-08T09:30:00Z",
      notes_count: 4,
      open_cards_count: 0,
    },
    {
      id: "sal-dha-02",
      name: "Peng's Hair Studio DHA",
      area: "DHA Phase 5",
      address: "Badar Commercial",
      phone: "0321-9876543",
      contact_person: "Madam Farida",
      stage: "regular",
      outstanding_balance: 28500,
      credit_limit: 80000,
      last_visited_at: "2026-11-14T11:00:00Z",
      notes_count: 2,
      open_cards_count: 0,
    },
  ];

  // Delivery orders: Toni&Guy delivered 11 days ago (cadence is 10 days for VIP -> critical alert expected!)
  const deliveries: DeliveryOrderFull[] = [
    {
      id: "ord-del-1",
      order_number: "ORD-2026-001",
      salon_id: "sal-clifton-01",
      salon_name: "Toni&Guy Clifton Branch",
      status: "delivered",
      delivered_at: "2026-11-04T10:00:00Z", // 11 days before reference date
      total_amount: 45000,
      items: [
        { sku_name: "Lumex Keratin Infusion Treatment 1L", qty: 10, price: 4500 },
      ],
    },
    {
      id: "ord-del-2",
      order_number: "ORD-2026-002",
      salon_id: "sal-dha-02",
      salon_name: "Peng's Hair Studio DHA",
      status: "delivered",
      delivered_at: "2026-11-13T10:00:00Z", // 2 days before reference date -> healthy!
      total_amount: 16000,
      items: [
        { sku_name: "Mocheqi Musk Smoothing Shampoo 750ml", qty: 8, price: 2000 },
      ],
    },
  ];

  const forecasts = computeSalonStockForecasts(
    salons,
    deliveries,
    INITIAL_SKUS,
    new Date("2026-11-15T12:00:00Z"),
  );

  assert.equal(forecasts.length, 2);

  const toniGuy = forecasts.find((f) => f.salonId === "sal-clifton-01");
  assert.ok(toniGuy);
  assert.equal(toniGuy.restockAlertLevel, "critical");
  assert.ok(toniGuy.estimatedDepletionDays <= 3);
  assert.ok(toniGuy.alertReason.includes("depleted") || toniGuy.alertReason.includes("cadence"));
  assert.ok(toniGuy.recommendedAction.includes("Rashid Ali"));

  const pengs = forecasts.find((f) => f.salonId === "sal-dha-02");
  assert.ok(pengs);
  assert.equal(pengs.restockAlertLevel, "healthy");
  assert.ok(pengs.estimatedDepletionDays > 5);

  // Test filter helper
  const criticalOnly = filterSalonStockForecasts(forecasts, { alertLevel: "critical" });
  assert.equal(criticalOnly.length, 1);
  assert.equal(criticalOnly[0].salonName, "Toni&Guy Clifton Branch");
});








