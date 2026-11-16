import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  mapOutboxFnToLiveRpc,
  mapCatalogueRowsToSkus,
  SupabaseRpcError,
} from "./supabase-kiran.js";
import { computeSalonStockForecasts } from "./salon-stock-forecast.js";
import type { DeliveryOrderFull, SalonWithApproval } from "../server/types.js";
import type { SKU } from "./data.js";

test("mapOutboxFnToLiveRpc maps rep_check_in accurately to Postgres RPC", () => {
  const result = mapOutboxFnToLiveRpc("rep_check_in", {
    p_counted: [{ sku_id: "a0000000-0000-0000-0000-000000000001", qty: 5 }],
    p_lat: 24.8607,
    p_lng: 67.0011,
  });

  assert.equal(result.rpcName, "rep_check_in");
  assert.deepEqual(result.rpcArgs.p_counted, [
    { sku_id: "a0000000-0000-0000-0000-000000000001", qty: 5 },
  ]);
  assert.equal(result.rpcArgs.p_lat, 24.8607);
  assert.equal(result.rpcArgs.p_lng, 67.0011);
  assert.ok(typeof result.rpcArgs.p_at_client === "string");
});

test("mapOutboxFnToLiveRpc maps record_count to bag spot check without creating shift records", () => {
  const result = mapOutboxFnToLiveRpc(
    "record_count",
    {
      p_kind: "spot_check",
      p_counted: [{ sku_id: "a0000000-0000-0000-0000-000000000002", qty: 12 }],
    },
    { defaultBagId: "b0000000-0000-0000-0000-000000000001" },
  );

  assert.equal(result.rpcName, "record_count");
  assert.equal(result.rpcArgs.p_location_id, "b0000000-0000-0000-0000-000000000001");
  assert.equal(result.rpcArgs.p_kind, "spot_check");
  assert.deepEqual(result.rpcArgs.p_counted, [
    { sku_id: "a0000000-0000-0000-0000-000000000002", qty: 12 },
  ]);
});

test("mapOutboxFnToLiveRpc normalizes log_visit and prevents invalid visit outcomes", () => {
  const result = mapOutboxFnToLiveRpc("log_visit", {
    p_salon_id: "s0000000-0000-0000-0000-000000000001",
    p_outcome: "contacted", // legacy UI value
    p_notes: "Owner requested catalog reprint",
  });

  assert.equal(result.rpcName, "log_visit");
  assert.equal(result.rpcArgs.p_outcome, "intro");
  assert.equal(result.rpcArgs.p_notes, "Owner requested catalog reprint");
  assert.equal(result.rpcArgs.p_mock_location, false);
});

test("mapOutboxFnToLiveRpc enforces unisex salon type for legacy 'salon' values", () => {
  const result = mapOutboxFnToLiveRpc("create_salon", {
    p_name: "Glamour Zone",
    p_type: "salon", // legacy invalid enum value
    p_address: "Zamzama Commercial, DHA Phase 5",
  });

  assert.equal(result.rpcName, "create_salon");
  assert.equal(result.rpcArgs.p_name, "Glamour Zone");
  assert.equal(result.rpcArgs.p_type, "unisex");
});

test("mapOutboxFnToLiveRpc strictly separates catalog SKUs and unknown demand groups", () => {
  const skuId = "11111111-1111-1111-1111-111111111111";
  const catalogDemand = mapOutboxFnToLiveRpc("record_demand", {
    p_sku_id: skuId,
    p_qty: 3,
    p_reason: "out_of_stock",
  });

  assert.equal(catalogDemand.rpcName, "record_demand");
  assert.equal(catalogDemand.rpcArgs.p_sku_id, skuId);
  assert.equal(catalogDemand.rpcArgs.p_product_group_id, null);

  const groupId = "22222222-2222-2222-2222-222222222222";
  const uncataloguedDemand = mapOutboxFnToLiveRpc("record_demand", {
    p_sku_id: skuId,
    p_product_group_id: groupId,
    p_qty: 6,
    p_reason: "not_in_catalogue",
  });

  assert.equal(uncataloguedDemand.rpcName, "record_demand");
  assert.equal(uncataloguedDemand.rpcArgs.p_sku_id, null);
  assert.equal(uncataloguedDemand.rpcArgs.p_product_group_id, groupId);
});

test("mapOutboxFnToLiveRpc rejects field-rep payment collection with 403 Forbidden", () => {
  assert.throws(
    () => {
      mapOutboxFnToLiveRpc("rep_record_payment", {
        p_salon_id: "s0000000-0000-0000-0000-000000000001",
        p_amount: 5000,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof SupabaseRpcError);
      assert.equal(err.status, 403);
      assert.match(err.message, /in-app and field-rep payments are disabled/i);
      return true;
    },
  );
});

test("mapCatalogueRowsToSkus defaults on-hand stock to 0 without fabricating sample inventory", () => {
  const catalogueRows = [
    {
      id: "p0000000-0000-0000-0000-000000000001",
      name: "Mocheqi Professional Keratin Shampoo",
      brand_label: "Mocheqi",
      group_name: "Treatment",
      skus: [
        {
          id: "k0000000-0000-0000-0000-000000000001",
          code: "MQ-KRT-500",
          variant: "500ml",
          list_price_paisa: 350000,
          active: true,
        },
      ],
    },
  ];

  // No availability rows provided
  const mapped = mapCatalogueRowsToSkus(catalogueRows, []);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.bag_qty, 0); // Zero on-hand default, never fabricated
  assert.equal(mapped[0]?.price, 3500); // 350,000 paisa -> 3,500 PKR
  assert.equal(mapped[0]?.brand, "Mocheqi");
});

test("computeSalonStockForecasts returns advisory data without fabricating historical orders", () => {
  const salon: SalonWithApproval = {
    id: "s0000000-0000-0000-0000-000000000099",
    name: "New Partner Salon",
    area: "Gulshan",
    address: "Block 13-A, Main University Rd",
    phone: "0300-1122334",
    contact_person: "Mrs. Khan",
    chairs: 6,
    credit_limit_pkr: 50000,
    outstanding_balance: 0,
    approval_status: "approved",
    stage: "trial",
  };

  const skus: SKU[] = [
    {
      id: "sku-1",
      sku_code: "MQ-1",
      name: "Mocheqi Hair Mask 500ml",
      category: "Treatment",
      price: 2500,
      bag_qty: 0,
      unit: "Bottle",
      brand: "Mocheqi",
      product_type: "Treatment",
      volume_size: "500ml",
      recommended_use: "Salon treatment",
    },
  ];

  // Zero deliveries
  const forecasts = computeSalonStockForecasts([salon], [], skus);
  assert.equal(forecasts.length, 1);
  const f = forecasts[0]!;
  assert.equal(f.hasHistoricalDeliveries, false);
  assert.equal(f.totalEstimatedStockOnHand, 0);
  assert.equal(f.totalStockValuePkr, 0);
  assert.equal(f.skuBreakdown.length, 0);
  assert.equal(f.suggestedReorderSkus.length, 0);
  assert.match(f.alertReason, /No historical deliveries recorded yet/i);
});

test("computeSalonStockForecasts computes realistic burn rates when deliveries exist", () => {
  const salon: SalonWithApproval = {
    id: "s0000000-0000-0000-0000-000000000001",
    name: "Toni&Guy Clifton Branch",
    area: "Clifton",
    address: "Block 4, Clifton",
    phone: "0300-9988776",
    contact_person: "Ayesha",
    chairs: 8,
    credit_limit_pkr: 100000,
    outstanding_balance: 0,
    approval_status: "approved",
    stage: "vip",
  };

  const skus: SKU[] = [
    {
      id: "sku-krt",
      sku_code: "MQ-KRT",
      name: "Mocheqi Brazilian Keratin 500ml",
      category: "Treatment",
      price: 6800,
      bag_qty: 10,
      unit: "Bottle",
      brand: "Mocheqi",
      product_type: "Treatment",
      volume_size: "500ml",
      recommended_use: "Professional treatment",
    },
  ];

  const deliveries: DeliveryOrderFull[] = [
    {
      id: "del-1",
      order_number: "ORD-001",
      salon_id: salon.id,
      salon_name: salon.name,
      items: [{ sku_name: "Mocheqi Brazilian Keratin 500ml", qty: 10, price: 6800 }],
      total_amount: 68000,
      status: "delivered",
      delivered_at: "2026-11-10T10:00:00Z", // 5 days before referenceNow (2026-11-15T12:00:00Z)
    },
  ];

  const forecasts = computeSalonStockForecasts(
    [salon],
    deliveries,
    skus,
    new Date("2026-11-15T12:00:00Z"),
  );

  assert.equal(forecasts.length, 1);
  const f = forecasts[0]!;
  assert.equal(f.hasHistoricalDeliveries, true);
  assert.equal(f.daysSinceLastDelivery, 5);
  assert.ok(f.totalEstimatedStockOnHand > 0);
  assert.equal(f.skuBreakdown.length, 1);
});

test("static source scan verifies zero traces of Firebase or obsolete demo login mechanisms", () => {
  const rootDir = path.resolve(process.cwd(), "src");
  const forbiddenPatterns = [
    { name: "Firebase library or config", regex: /['"]firebase\/|['"]firebase['"]/ },
    { name: "gnzsolutions Firebase project", regex: /gnzsolutions/ },
    { name: "Google Drive backup artifact", regex: /google-drive/ },
    { name: "Demo quick sign-in method", regex: /signInDemo/ },
    { name: "Lumex DMS header", regex: /Lumex DMS/ },
  ];

  function scanDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "kiran-workflows.test.ts") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        for (const pattern of forbiddenPatterns) {
          const match = pattern.regex.exec(content);
          assert.equal(
            match,
            null,
            `Forbidden pattern '${pattern.name}' detected in file: ${path.relative(process.cwd(), fullPath)}`,
          );
        }
      }
    }
  }

  scanDir(rootDir);
});
