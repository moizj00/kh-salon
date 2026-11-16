import type { DeliveryOrderFull, SalonWithApproval } from "../server/types";
import type { SKU } from "./data";

export type RestockAlertLevel = "critical" | "warning" | "healthy";

export interface SkuStockEstimate {
  skuId: string;
  skuName: string;
  skuCode?: string;
  brand?: string;
  category?: string;
  lastDeliveredQty: number;
  lastDeliveredAt: string | null;
  estimatedUnitsOnHand: number;
  dailyConsumptionRate: number;
  daysOfStockLeft: number;
  unitPricePkr: number;
  stockStatus: RestockAlertLevel;
}

export interface SalonStockForecast {
  salonId: string;
  salonName: string;
  area: string;
  address: string;
  phone: string;
  contactPerson: string;
  stage: "prospect" | "trial" | "regular" | "vip";
  totalEstimatedStockOnHand: number;
  totalStockValuePkr: number;
  orderFrequencyDays: number;
  daysSinceLastDelivery: number;
  lastDeliveryDate: string | null;
  lastDeliveredUnits: number;
  totalOrdersDelivered: number;
  hasHistoricalDeliveries: boolean;
  estimatedDepletionDays: number;
  restockAlertLevel: RestockAlertLevel;
  alertReason: string;
  recommendedAction: string;
  suggestedReorderSkus: Array<{
    skuId: string;
    skuName: string;
    suggestedQty: number;
    price: number;
  }>;
  skuBreakdown: SkuStockEstimate[];
}

const STAGE_DEFAULT_FREQUENCY_DAYS: Record<string, number> = {
  vip: 10,
  regular: 14,
  trial: 21,
  prospect: 30,
};

const STAGE_DAILY_BURN_MULTIPLIER: Record<string, number> = {
  vip: 1.4,
  regular: 1.0,
  trial: 0.6,
  prospect: 0.4,
};

/**
 * Computes live salon stock estimates and proactive restocking alerts
 * based on order history, cadence, and salon capacity.
 */
export function computeSalonStockForecasts(
  salons: SalonWithApproval[],
  deliveries: DeliveryOrderFull[],
  skus: SKU[],
  referenceNow: Date = new Date("2026-11-15T12:00:00Z"),
): SalonStockForecast[] {
  const skuMap = new Map<string, SKU>();
  for (const sku of skus) {
    skuMap.set(sku.id, sku);
    skuMap.set(sku.name.toLowerCase().trim(), sku);
  }

  // Group deliveries by salon
  const deliveriesBySalon = new Map<string, DeliveryOrderFull[]>();
  for (const d of deliveries) {
    const list = deliveriesBySalon.get(d.salon_id) ?? [];
    list.push(d);
    deliveriesBySalon.set(d.salon_id, list);
  }

  return salons.map((salon) => {
    const salonDeliveries = deliveriesBySalon.get(salon.id) ?? [];
    const deliveredOrders = salonDeliveries.filter((d) => d.status === "delivered");
    const stage = salon.stage ?? "regular";
    const defaultFrequency = STAGE_DEFAULT_FREQUENCY_DAYS[stage] ?? 14;
    const stageMultiplier = STAGE_DAILY_BURN_MULTIPLIER[stage] ?? 1.0;

    // Calculate historical order cadence in days
    let orderFrequencyDays = defaultFrequency;
    if (deliveredOrders.length >= 2) {
      const timestamps = deliveredOrders
        .map((d) => {
          const t = d.delivered_at || d.created_at;
          return t ? new Date(t).getTime() : NaN;
        })
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b);

      if (timestamps.length >= 2) {
        const spanDays = (timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24);
        const avgCadence = Math.round(spanDays / (timestamps.length - 1));
        if (avgCadence >= 5 && avgCadence <= 45) {
          orderFrequencyDays = avgCadence;
        }
      }
    }

    // Determine last delivery timestamp
    let lastDeliveryDate: string | null = null;
    let daysSinceLastDelivery = 0;
    let lastDeliveredUnits = 0;

    const hasHistoricalDeliveries = deliveredOrders.length > 0;

    if (hasHistoricalDeliveries) {
      // Find the most recent delivered order
      const sorted = [...deliveredOrders].sort((a, b) => {
        const ta = a.delivered_at || a.created_at || "";
        const tb = b.delivered_at || b.created_at || "";
        return new Date(tb).getTime() - new Date(ta).getTime();
      });
      const mostRecent = sorted[0];
      lastDeliveryDate = mostRecent.delivered_at || mostRecent.created_at || null;
      if (lastDeliveryDate) {
        const msElapsed = referenceNow.getTime() - new Date(lastDeliveryDate).getTime();
        daysSinceLastDelivery = Math.max(0, Math.floor(msElapsed / (1000 * 60 * 60 * 24)));
      }
      lastDeliveredUnits = mostRecent.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    } else if (salon.last_visited_at) {
      const msElapsed = referenceNow.getTime() - new Date(salon.last_visited_at).getTime();
      daysSinceLastDelivery = Math.max(0, Math.floor(msElapsed / (1000 * 60 * 60 * 24)));
    }

    // Accumulate items from actual delivered orders only (never fabricate deliveries)
    const skuAggregates = new Map<
      string,
      {
        skuName: string;
        totalDeliveredQty: number;
        lastDeliveredQty: number;
        lastPrice: number;
        lastDeliveredAt: string | null;
      }
    >();

    for (const order of deliveredOrders) {
      const orderDate = order.delivered_at || order.created_at || null;
      for (const item of order.items) {
        const key = item.sku_name.trim();
        const existing = skuAggregates.get(key) ?? {
          skuName: item.sku_name,
          totalDeliveredQty: 0,
          lastDeliveredQty: 0,
          lastPrice: item.price || 0,
          lastDeliveredAt: null,
        };
        existing.totalDeliveredQty += Number(item.qty) || 0;
        existing.lastDeliveredQty = Number(item.qty) || existing.lastDeliveredQty;
        existing.lastPrice = item.price || existing.lastPrice;
        if (!existing.lastDeliveredAt || (orderDate && new Date(orderDate) > new Date(existing.lastDeliveredAt))) {
          existing.lastDeliveredAt = orderDate;
        }
        skuAggregates.set(key, existing);
      }
    }

    if (!hasHistoricalDeliveries || skuAggregates.size === 0) {
      return {
        salonId: salon.id,
        salonName: salon.name,
        area: salon.area,
        address: salon.address,
        phone: salon.phone,
        contactPerson: salon.contact_person,
        stage,
        totalEstimatedStockOnHand: 0,
        totalStockValuePkr: 0,
        orderFrequencyDays,
        daysSinceLastDelivery,
        lastDeliveryDate: null,
        lastDeliveredUnits: 0,
        totalOrdersDelivered: 0,
        hasHistoricalDeliveries: false,
        estimatedDepletionDays: 0,
        restockAlertLevel: "healthy",
        alertReason: "No historical deliveries recorded yet — forecast awaits first confirmed delivery.",
        recommendedAction: "Record or deliver the salon's first official order to start depletion tracking.",
        suggestedReorderSkus: [],
        skuBreakdown: [],
      };
    }

    // Compute SKU breakdowns
    const skuBreakdown: SkuStockEstimate[] = [];
    const suggestedReorderSkus: SalonStockForecast["suggestedReorderSkus"] = [];
    let minDaysOfStockLeft = 999;
    let totalEstimatedUnits = 0;
    let totalStockValuePkr = 0;

    for (const [name, agg] of skuAggregates.entries()) {
      const matchedSku = skuMap.get(name.toLowerCase()) || skus.find((s) => s.name.toLowerCase() === name.toLowerCase());
      const skuId = matchedSku?.id || `sku-gen-${skuBreakdown.length + 1}`;
      const unitPrice = agg.lastPrice || matchedSku?.price || 4500;

      // Base daily consumption rate
      const baseDailyRate = agg.lastDeliveredQty / Math.max(1, orderFrequencyDays);
      const adjustedDailyRate = Math.max(0.1, Number((baseDailyRate * stageMultiplier).toFixed(2)));

      // Estimated units left
      const unitsConsumed = Math.floor(daysSinceLastDelivery * adjustedDailyRate);
      const unitsOnHand = Math.max(0, agg.lastDeliveredQty - unitsConsumed);
      const daysOfStockLeft = adjustedDailyRate > 0 ? Math.floor(unitsOnHand / adjustedDailyRate) : 30;

      totalEstimatedUnits += unitsOnHand;
      totalStockValuePkr += unitsOnHand * unitPrice;

      if (daysOfStockLeft < minDaysOfStockLeft) {
        minDaysOfStockLeft = daysOfStockLeft;
      }

      let stockStatus: RestockAlertLevel = "healthy";
      if (daysOfStockLeft <= 3 || unitsOnHand <= 2) {
        stockStatus = "critical";
      } else if (daysOfStockLeft <= 7 || unitsOnHand <= 4) {
        stockStatus = "warning";
      }

      if (stockStatus !== "healthy") {
        suggestedReorderSkus.push({
          skuId,
          skuName: name,
          suggestedQty: Math.max(4, agg.lastDeliveredQty),
          price: unitPrice,
        });
      }

      skuBreakdown.push({
        skuId,
        skuName: name,
        skuCode: matchedSku?.sku_code,
        brand: matchedSku?.brand || (name.toLowerCase().includes("mocheqi") ? "Mocheqi Musk" : "Lumex"),
        category: matchedSku?.category || "Treatment",
        lastDeliveredQty: agg.lastDeliveredQty,
        lastDeliveredAt: agg.lastDeliveredAt,
        estimatedUnitsOnHand: unitsOnHand,
        dailyConsumptionRate: adjustedDailyRate,
        daysOfStockLeft,
        unitPricePkr: unitPrice,
        stockStatus,
      });
    }

    if (minDaysOfStockLeft === 999) {
      minDaysOfStockLeft = 14;
    }

    // Determine overall salon urgency
    let restockAlertLevel: RestockAlertLevel = "healthy";
    let alertReason = "Stock levels healthy across all product lines.";
    let recommendedAction = "No action required at this time.";

    const criticalCount = skuBreakdown.filter((s) => s.stockStatus === "critical").length;
    const warningCount = skuBreakdown.filter((s) => s.stockStatus === "warning").length;

    if (criticalCount > 0 || daysSinceLastDelivery >= orderFrequencyDays - 1) {
      restockAlertLevel = "critical";
      const criticalItem = skuBreakdown.find((s) => s.stockStatus === "critical") || skuBreakdown[0];
      alertReason = `Stock depleted: ~${criticalItem?.estimatedUnitsOnHand ?? 0} units of ${criticalItem?.skuName ?? "main SKU"} remaining. Last restocked ${daysSinceLastDelivery} days ago (cadence is ${orderFrequencyDays} days).`;
      recommendedAction = `Immediate call to ${salon.contact_person || "Manager"} (${salon.phone}) to pre-empt salon stockout.`;
    } else if (warningCount > 0 || daysSinceLastDelivery >= orderFrequencyDays - 4) {
      restockAlertLevel = "warning";
      alertReason = `Reorder cycle window active: ~${minDaysOfStockLeft} days of estimated stock remaining. Reorder cadence is every ${orderFrequencyDays} days.`;
      recommendedAction = `Follow-up call with ${salon.contact_person || "Stylist"} within 48h to schedule restock delivery.`;
    }

    return {
      salonId: salon.id,
      salonName: salon.name,
      area: salon.area,
      address: salon.address,
      phone: salon.phone,
      contactPerson: salon.contact_person,
      stage,
      totalEstimatedStockOnHand: totalEstimatedUnits,
      totalStockValuePkr,
      orderFrequencyDays,
      daysSinceLastDelivery,
      lastDeliveryDate,
      lastDeliveredUnits,
      totalOrdersDelivered: deliveredOrders.length,
      hasHistoricalDeliveries: true,
      estimatedDepletionDays: minDaysOfStockLeft,
      restockAlertLevel,
      alertReason,
      recommendedAction,
      suggestedReorderSkus:
        suggestedReorderSkus.length > 0
          ? suggestedReorderSkus
          : skuBreakdown.slice(0, 2).map((s) => ({
              skuId: s.skuId,
              skuName: s.skuName,
              suggestedQty: 6,
              price: s.unitPricePkr,
            })),
      skuBreakdown,
    };
  });
}

/**
 * Filter and sort forecasts for office manager triage
 */
export function filterSalonStockForecasts(
  forecasts: SalonStockForecast[],
  options: {
    alertLevel?: "all" | RestockAlertLevel;
    query?: string;
    area?: string;
    sortBy?: "urgency" | "name" | "stock_low_first" | "cadence";
  } = {},
): SalonStockForecast[] {
  const { alertLevel = "all", query = "", area = "all", sortBy = "urgency" } = options;
  const q = query.trim().toLowerCase();

  const filtered = forecasts.filter((f) => {
    if (alertLevel !== "all" && f.restockAlertLevel !== alertLevel) {
      return false;
    }
    if (area !== "all" && !f.area.toLowerCase().includes(area.toLowerCase())) {
      return false;
    }
    if (q) {
      const matchName = f.salonName.toLowerCase().includes(q);
      const matchArea = f.area.toLowerCase().includes(q);
      const matchContact = f.contactPerson.toLowerCase().includes(q);
      const matchPhone = f.phone.includes(q);
      const matchSku = f.skuBreakdown.some((s) => s.skuName.toLowerCase().includes(q));
      if (!matchName && !matchArea && !matchContact && !matchPhone && !matchSku) {
        return false;
      }
    }
    return true;
  });

  return filtered.sort((a, b) => {
    if (sortBy === "urgency") {
      const rank = { critical: 0, warning: 1, healthy: 2 };
      if (rank[a.restockAlertLevel] !== rank[b.restockAlertLevel]) {
        return rank[a.restockAlertLevel] - rank[b.restockAlertLevel];
      }
      return a.estimatedDepletionDays - b.estimatedDepletionDays;
    }
    if (sortBy === "name") {
      return a.salonName.localeCompare(b.salonName);
    }
    if (sortBy === "stock_low_first") {
      return a.totalEstimatedStockOnHand - b.totalEstimatedStockOnHand;
    }
    if (sortBy === "cadence") {
      return a.orderFrequencyDays - b.orderFrequencyDays;
    }
    return 0;
  });
}
