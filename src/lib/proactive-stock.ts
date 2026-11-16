import type { DeliveryOrderFull, SalonWithApproval } from "../server/types";
import type { SKU } from "./data";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "./order-stock";
import { getSupabaseClient } from "./supabase";

export interface StockCountRecord {
  id: string;
  salonId: string;
  skuId: string;
  skuName: string;
  skuCode?: string;
  brand?: string;
  countedQty: number;
  safetyThreshold: number;
  countedAt: string;
}

export interface SalesOrderLineRecord {
  id: string;
  orderId: string;
  salonId: string;
  skuId: string;
  skuName: string;
  skuCode?: string;
  brand?: string;
  qty: number;
  unitPricePkr: number;
  orderedAt: string;
}

export interface ProductBelowSafetyStock {
  skuId: string;
  skuName: string;
  skuCode: string;
  brand: string;
  safetyThreshold: number;
  salonsBelowCount: number;
  totalClientSalons: number;
  lowestSalonStock: number;
  totalUnitsDeficit: number;
  affectedSalons: Array<{
    salonId: string;
    salonName: string;
    phone: string;
    contactPerson: string;
    currentQty: number;
    deficitQty: number;
  }>;
}

export interface SalonProactiveSkuStatus {
  skuId: string;
  skuName: string;
  skuCode: string;
  brand: string;
  currentQty: number;
  safetyThreshold: number;
  belowSafety: boolean;
  totalOrderedUnits: number;
  lastOrderedQty: number;
  unitPricePkr: number;
  lastCountedAt: string | null;
}

export interface SalonProactiveFollowUp {
  salonId: string;
  salonName: string;
  area: string;
  contactPerson: string;
  phone: string;
  stage: "prospect" | "trial" | "regular" | "vip";
  totalOrdersCount: number;
  orderFrequencyDays: number;
  daysSinceLastOrder: number;
  lastOrderAt: string | null;
  lastStockCountAt: string | null;
  belowSafetySkusCount: number;
  totalOnHandUnits: number;
  urgency: "critical" | "followup_due" | "healthy";
  followUpReason: string;
  callTalkingPoints: string;
  skuStatuses: SalonProactiveSkuStatus[];
}

export interface ProactiveStockAnalysisResult {
  belowSafetyProducts: ProductBelowSafetyStock[];
  salonFollowUps: SalonProactiveFollowUp[];
  dataSource: "supabase_live" | "workspace_derived";
  lastAnalyzedAt: string;
}

const STAGE_CADENCE_DAYS: Record<string, number> = {
  vip: 10,
  regular: 14,
  trial: 21,
  prospect: 30,
};

const STAGE_BURN_MULTIPLIER: Record<string, number> = {
  vip: 1.35,
  regular: 1.0,
  trial: 0.65,
  prospect: 0.4,
};

/**
 * Fetches raw `stock_count`, `sales_order_line`, and optional `reorder_rule` rows from Supabase.
 */
export async function fetchLiveProactiveStockInputs(
  skus: SKU[],
): Promise<{
  stockCounts: StockCountRecord[];
  orderLines: SalesOrderLineRecord[];
  safetyBySkuId: Map<string, number>;
  source: "supabase_live" | "workspace_derived";
}> {
  const client = await getSupabaseClient();
  if (!client) {
    return {
      stockCounts: [],
      orderLines: [],
      safetyBySkuId: new Map(),
      source: "workspace_derived",
    };
  }

  const skuById = new Map(skus.map((s) => [s.id, s]));

  const [stockCountRes, orderLinesRes, reorderRes] = await Promise.all([
    client
      .from("stock_count")
      .select(
        "id, salon_id, location_id, sku_id, counted_qty, qty, safety_stock_threshold, min_qty, counted_at, created_at, sku(id, code, variant, product(name, brand_label))",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("sales_order_line")
      .select(
        "id, order_id, sku_id, qty, unit_price_paisa, created_at, sales_order(salon_id, ordered_at, created_at, status), sku(id, code, variant, product(name, brand_label))",
      )
      .order("created_at", { ascending: false })
      .limit(300),
    client.from("reorder_rule").select("sku_id, min_qty, safety_stock_qty").limit(100),
  ]);

  const safetyBySkuId = new Map<string, number>();
  if (!reorderRes.error && Array.isArray(reorderRes.data)) {
    for (const row of reorderRes.data as Array<Record<string, unknown>>) {
      const skuId = String(row.sku_id ?? "");
      const minQty = Number(row.safety_stock_qty ?? row.min_qty ?? 0);
      if (skuId && Number.isFinite(minQty) && minQty > 0) {
        safetyBySkuId.set(skuId, minQty);
      }
    }
  }

  const stockCounts: StockCountRecord[] = [];
  if (!stockCountRes.error && Array.isArray(stockCountRes.data)) {
    for (const row of stockCountRes.data as Array<Record<string, unknown>>) {
      const salonId = String(row.salon_id ?? row.location_id ?? "");
      const skuId = String(row.sku_id ?? "");
      if (!salonId || !skuId) continue;

      const skuRel = row.sku as {
        id?: string;
        code?: string;
        variant?: string;
        product?: { name?: string; brand_label?: string };
      } | null;
      const fallbackSku = skuById.get(skuId);
      const skuName = skuRel?.product?.name
        ? `${skuRel.product.name} ${skuRel.variant ?? ""}`.trim()
        : fallbackSku?.name ?? skuRel?.code ?? "Product SKU";
      const safety = Number(
        row.safety_stock_threshold ??
          row.min_qty ??
          safetyBySkuId.get(skuId) ??
          DEFAULT_LOW_STOCK_THRESHOLD,
      );

      stockCounts.push({
        id: String(row.id ?? `${salonId}-${skuId}`),
        salonId,
        skuId,
        skuName,
        skuCode: skuRel?.code ?? fallbackSku?.sku_code,
        brand: skuRel?.product?.brand_label ?? fallbackSku?.brand,
        countedQty: Math.max(0, Number(row.counted_qty ?? row.qty ?? 0)),
        safetyThreshold: safety > 0 ? safety : DEFAULT_LOW_STOCK_THRESHOLD,
        countedAt: String(row.counted_at ?? row.created_at ?? new Date().toISOString()),
      });
    }
  }

  const orderLines: SalesOrderLineRecord[] = [];
  if (!orderLinesRes.error && Array.isArray(orderLinesRes.data)) {
    for (const row of orderLinesRes.data as Array<Record<string, unknown>>) {
      const orderRel = row.sales_order as {
        salon_id?: string;
        ordered_at?: string;
        created_at?: string;
        status?: string;
      } | null;
      const salonId = String(orderRel?.salon_id ?? "");
      const skuId = String(row.sku_id ?? "");
      if (!salonId || !skuId) continue;

      const skuRel = row.sku as {
        id?: string;
        code?: string;
        variant?: string;
        product?: { name?: string; brand_label?: string };
      } | null;
      const fallbackSku = skuById.get(skuId);
      const skuName = skuRel?.product?.name
        ? `${skuRel.product.name} ${skuRel.variant ?? ""}`.trim()
        : fallbackSku?.name ?? skuRel?.code ?? "Product SKU";
      const unitPaisa = Number(row.unit_price_paisa ?? 0);

      orderLines.push({
        id: String(row.id ?? `${row.order_id}-${skuId}`),
        orderId: String(row.order_id ?? ""),
        salonId,
        skuId,
        skuName,
        skuCode: skuRel?.code ?? fallbackSku?.sku_code,
        brand: skuRel?.product?.brand_label ?? fallbackSku?.brand,
        qty: Math.max(1, Number(row.qty ?? 1)),
        unitPricePkr:
          unitPaisa > 0 ? Math.round(unitPaisa / 100) : fallbackSku?.price ?? 2500,
        orderedAt: String(
          orderRel?.ordered_at ?? orderRel?.created_at ?? row.created_at ?? new Date().toISOString(),
        ),
      });
    }
  }

  const hasLiveData = stockCounts.length > 0 || orderLines.length > 0;
  return {
    stockCounts,
    orderLines,
    safetyBySkuId,
    source: hasLiveData ? "supabase_live" : "workspace_derived",
  };
}

/**
 * Pure analyzer combining `stock_count`, `sales_order_line`, and salon delivery data
 * to compute:
 *  1) Products below safety stock threshold across all salons (Dashboard Widget)
 *  2) Salon follow-up call prioritization based on order frequency & stock levels
 */
export function analyzeProactiveSalonStock(params: {
  salons: SalonWithApproval[];
  skus: SKU[];
  stockCountRows?: StockCountRecord[];
  salesOrderLines?: SalesOrderLineRecord[];
  deliveries?: DeliveryOrderFull[];
  safetyBySkuId?: Map<string, number>;
  defaultSafetyThreshold?: number;
  dataSource?: "supabase_live" | "workspace_derived";
  referenceNow?: Date;
}): ProactiveStockAnalysisResult {
  const {
    salons,
    skus,
    stockCountRows = [],
    salesOrderLines = [],
    deliveries = [],
    safetyBySkuId = new Map<string, number>(),
    defaultSafetyThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
    dataSource = stockCountRows.length > 0 || salesOrderLines.length > 0
      ? "supabase_live"
      : "workspace_derived",
    referenceNow = new Date("2026-11-16T01:00:00Z"),
  } = params;

  const skuById = new Map<string, SKU>();
  const skuByName = new Map<string, SKU>();
  for (const s of skus) {
    skuById.set(s.id, s);
    skuByName.set(s.name.toLowerCase().trim(), s);
  }

  // Group stock_count rows by salonId -> latest per skuId
  const stockBySalon = new Map<string, Map<string, StockCountRecord>>();
  for (const sc of stockCountRows) {
    const salonMap = stockBySalon.get(sc.salonId) ?? new Map<string, StockCountRecord>();
    const existing = salonMap.get(sc.skuId);
    if (!existing || new Date(sc.countedAt) > new Date(existing.countedAt)) {
      salonMap.set(sc.skuId, sc);
    }
    stockBySalon.set(sc.salonId, salonMap);
  }

  // Group sales_order_line by salonId; if empty, synthesize from deliveries
  const linesBySalon = new Map<string, SalesOrderLineRecord[]>();
  for (const line of salesOrderLines) {
    const list = linesBySalon.get(line.salonId) ?? [];
    list.push(line);
    linesBySalon.set(line.salonId, list);
  }

  if (salesOrderLines.length === 0 && deliveries.length > 0) {
    for (const del of deliveries) {
      const list = linesBySalon.get(del.salon_id) ?? [];
      const orderDate = del.delivered_at || del.created_at || referenceNow.toISOString();
      del.items.forEach((item, idx) => {
        const matched = skuByName.get(item.sku_name.toLowerCase().trim());
        list.push({
          id: `${del.id}-line-${idx}`,
          orderId: del.id,
          salonId: del.salon_id,
          skuId: matched?.id ?? `sku-derived-${idx}`,
          skuName: item.sku_name,
          skuCode: matched?.sku_code,
          brand: matched?.brand,
          qty: Number(item.qty) || 1,
          unitPricePkr: item.price || matched?.price || 2500,
          orderedAt: orderDate,
        });
      });
      linesBySalon.set(del.salon_id, list);
    }
  }

  // Cross-salon accumulator for the Safety Stock Threshold Dashboard Widget
  const widgetProductMap = new Map<string, ProductBelowSafetyStock>();
  const salonFollowUps: SalonProactiveFollowUp[] = [];

  for (const salon of salons) {
    const stage = salon.stage ?? "regular";
    const salonLines = linesBySalon.get(salon.id) ?? [];
    const salonCounts = stockBySalon.get(salon.id) ?? new Map<string, StockCountRecord>();

    // Determine order cadence (frequency in days) from distinct orders
    const orderTimestampsMap = new Map<string, number>();
    for (const line of salonLines) {
      const ts = new Date(line.orderedAt).getTime();
      if (Number.isFinite(ts)) {
        orderTimestampsMap.set(line.orderId, ts);
      }
    }
    const orderTimestamps = Array.from(orderTimestampsMap.values()).sort((a, b) => a - b);

    let orderFrequencyDays = STAGE_CADENCE_DAYS[stage] ?? 14;
    if (orderTimestamps.length >= 2) {
      const spanDays =
        (orderTimestamps[orderTimestamps.length - 1] - orderTimestamps[0]) / (1000 * 60 * 60 * 24);
      const avg = Math.round(spanDays / (orderTimestamps.length - 1));
      if (avg >= 4 && avg <= 45) {
        orderFrequencyDays = avg;
      }
    }

    const lastOrderTs =
      orderTimestamps.length > 0
        ? orderTimestamps[orderTimestamps.length - 1]
        : salon.last_visited_at
          ? new Date(salon.last_visited_at).getTime()
          : referenceNow.getTime() - (stage === "vip" ? 9 : stage === "regular" ? 12 : 15) * 86400000;

    const lastOrderAt = new Date(lastOrderTs).toISOString();
    const daysSinceLastOrder = Math.max(
      0,
      Math.floor((referenceNow.getTime() - lastOrderTs) / (1000 * 60 * 60 * 24)),
    );

    // Aggregate SKU activity & latest stock count per salon
    const skuTotals = new Map<
      string,
      {
        skuId: string;
        skuName: string;
        skuCode: string;
        brand: string;
        totalOrderedUnits: number;
        lastOrderedQty: number;
        unitPricePkr: number;
        orderCount: number;
      }
    >();

    for (const line of salonLines) {
      const existing = skuTotals.get(line.skuId) ?? {
        skuId: line.skuId,
        skuName: line.skuName,
        skuCode: line.skuCode ?? skuById.get(line.skuId)?.sku_code ?? "KRN-SKU",
        brand: line.brand ?? skuById.get(line.skuId)?.brand ?? "Kiran Professional",
        totalOrderedUnits: 0,
        lastOrderedQty: line.qty,
        unitPricePkr: line.unitPricePkr,
        orderCount: 0,
      };
      existing.totalOrderedUnits += line.qty;
      existing.lastOrderedQty = line.qty;
      existing.orderCount += 1;
      skuTotals.set(line.skuId, existing);
    }

    // Ensure any SKU in stock_count for this salon is included even without order lines
    for (const [skuId, sc] of salonCounts.entries()) {
      if (!skuTotals.has(skuId)) {
        const matched = skuById.get(skuId);
        skuTotals.set(skuId, {
          skuId,
          skuName: sc.skuName,
          skuCode: sc.skuCode ?? matched?.sku_code ?? "KRN-SKU",
          brand: sc.brand ?? matched?.brand ?? "Kiran Professional",
          totalOrderedUnits: sc.countedQty,
          lastOrderedQty: sc.countedQty,
          unitPricePkr: matched?.price ?? 2500,
          orderCount: 0,
        });
      }
    }

    // If a client salon has no explicit stock_count or sales_order_line rows yet, derive representative core SKUs
    if (skuTotals.size === 0 && skus.length > 0) {
      const seedCount = stage === "vip" ? 3 : 2;
      for (const s of skus.slice(0, seedCount)) {
        const seededQty = stage === "vip" ? 8 : stage === "regular" ? 6 : 4;
        skuTotals.set(s.id, {
          skuId: s.id,
          skuName: s.name,
          skuCode: s.sku_code,
          brand: s.brand ?? "Kiran Professional",
          totalOrderedUnits: seededQty,
          lastOrderedQty: seededQty,
          unitPricePkr: s.price,
          orderCount: 1,
        });
      }
    }

    const burnMultiplier = STAGE_BURN_MULTIPLIER[stage] ?? 1.0;
    const skuStatuses: SalonProactiveSkuStatus[] = [];
    let latestStockCountAt: string | null = null;
    let totalOnHandUnits = 0;
    let belowSafetySkusCount = 0;

    for (const agg of skuTotals.values()) {
      const sc = salonCounts.get(agg.skuId);
      const safetyThreshold =
        sc?.safetyThreshold ?? safetyBySkuId.get(agg.skuId) ?? defaultSafetyThreshold;

      let currentQty: number;
      if (sc) {
        currentQty = sc.countedQty;
        if (!latestStockCountAt || new Date(sc.countedAt) > new Date(latestStockCountAt)) {
          latestStockCountAt = sc.countedAt;
        }
      } else {
        const dailyRate = (agg.lastOrderedQty / Math.max(1, orderFrequencyDays)) * burnMultiplier;
        const estimatedConsumed = Math.floor(daysSinceLastOrder * dailyRate);
        currentQty = Math.max(0, agg.lastOrderedQty - estimatedConsumed);
      }

      const belowSafety = currentQty < safetyThreshold;
      if (belowSafety) {
        belowSafetySkusCount += 1;

        // Populate dashboard safety stock widget
        const deficitQty = safetyThreshold - currentQty;
        const widgetEntry = widgetProductMap.get(agg.skuId) ?? {
          skuId: agg.skuId,
          skuName: agg.skuName,
          skuCode: agg.skuCode,
          brand: agg.brand,
          safetyThreshold,
          salonsBelowCount: 0,
          totalClientSalons: salons.length,
          lowestSalonStock: currentQty,
          totalUnitsDeficit: 0,
          affectedSalons: [],
        };
        widgetEntry.salonsBelowCount += 1;
        widgetEntry.lowestSalonStock = Math.min(widgetEntry.lowestSalonStock, currentQty);
        widgetEntry.totalUnitsDeficit += deficitQty;
        widgetEntry.affectedSalons.push({
          salonId: salon.id,
          salonName: salon.name,
          phone: salon.phone,
          contactPerson: salon.contact_person,
          currentQty,
          deficitQty,
        });
        widgetProductMap.set(agg.skuId, widgetEntry);
      }

      totalOnHandUnits += currentQty;
      skuStatuses.push({
        skuId: agg.skuId,
        skuName: agg.skuName,
        skuCode: agg.skuCode,
        brand: agg.brand,
        currentQty,
        safetyThreshold,
        belowSafety,
        totalOrderedUnits: agg.totalOrderedUnits,
        lastOrderedQty: agg.lastOrderedQty,
        unitPricePkr: agg.unitPricePkr,
        lastCountedAt: sc?.countedAt ?? null,
      });
    }

    const cycleOverdue = daysSinceLastOrder >= orderFrequencyDays - 1;
    const cycleApproaching = daysSinceLastOrder >= orderFrequencyDays - 4;
    const hasCriticalStock = skuStatuses.some((s) => s.currentQty <= Math.max(2, Math.floor(s.safetyThreshold * 0.4)));

    let urgency: SalonProactiveFollowUp["urgency"] = "healthy";
    let followUpReason = "Inventory above safety threshold and within normal order cycle.";
    let callTalkingPoints = `Routine check-in with ${salon.contact_person || "stylist"} on next cycle.`;

    if (hasCriticalStock || (belowSafetySkusCount > 0 && cycleOverdue)) {
      urgency = "critical";
      const lowNames = skuStatuses
        .filter((s) => s.belowSafety)
        .slice(0, 2)
        .map((s) => `${s.skuName} (${s.currentQty}/${s.safetyThreshold})`)
        .join(", ");
      followUpReason = `${belowSafetySkusCount} SKU(s) below safety stock [${lowNames}] and ${daysSinceLastOrder}d since last order (cadence: ${orderFrequencyDays}d).`;
      callTalkingPoints = `Call ${salon.contact_person || "salon manager"} (${salon.phone}) immediately to prevent stockout and confirm restock quantities.`;
    } else if (belowSafetySkusCount > 0 || cycleApproaching) {
      urgency = "followup_due";
      followUpReason =
        belowSafetySkusCount > 0
          ? `${belowSafetySkusCount} SKU(s) dipped below safety stock minimum; follow-up call due before weekend demand.`
          : `Order frequency window (${orderFrequencyDays}d cycle) reaches threshold in ${Math.max(1, orderFrequencyDays - daysSinceLastOrder)}d.`;
      callTalkingPoints = `Schedule proactive follow-up call with ${salon.contact_person || "owner"} to lock in next restock order.`;
    }

    salonFollowUps.push({
      salonId: salon.id,
      salonName: salon.name,
      area: salon.area,
      contactPerson: salon.contact_person,
      phone: salon.phone,
      stage,
      totalOrdersCount: Math.max(orderTimestamps.length, salonLines.length > 0 ? 1 : 0),
      orderFrequencyDays,
      daysSinceLastOrder,
      lastOrderAt,
      lastStockCountAt: latestStockCountAt,
      belowSafetySkusCount,
      totalOnHandUnits,
      urgency,
      followUpReason,
      callTalkingPoints,
      skuStatuses: skuStatuses.sort((a, b) => Number(b.belowSafety) - Number(a.belowSafety)),
    });
  }

  const belowSafetyProducts = Array.from(widgetProductMap.values()).sort(
    (a, b) => b.salonsBelowCount - a.salonsBelowCount || b.totalUnitsDeficit - a.totalUnitsDeficit,
  );

  const urgencyRank = { critical: 0, followup_due: 1, healthy: 2 };
  salonFollowUps.sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      b.belowSafetySkusCount - a.belowSafetySkusCount ||
      b.daysSinceLastOrder - a.daysSinceLastOrder,
  );

  return {
    belowSafetyProducts,
    salonFollowUps,
    dataSource,
    lastAnalyzedAt: referenceNow.toISOString(),
  };
}
