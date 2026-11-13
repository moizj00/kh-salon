import type { DeliveryOrderFull } from "../server/types.ts";

export interface DailyDeliveryTrendPoint {
  dateKey: string;
  label: string;
  deliveredCount: number;
  pendingCount: number;
  completedRevenuePkr: number;
}

export interface DeliveryTrendsSummary {
  days: DailyDeliveryTrendPoint[];
  totalDelivered30d: number;
  totalPending30d: number;
  completionRatePct: number;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDayLabel(dateKey: string): string {
  const [, monthStr, dayStr] = dateKey.split("-");
  const monthIdx = Math.max(0, Math.min(11, Number(monthStr) - 1));
  return `${MONTH_ABBR[monthIdx]} ${Number(dayStr)}`;
}

export function buildLast30DaysDeliveryTrends(
  orders: DeliveryOrderFull[],
  referenceDate: Date = new Date(),
): DeliveryTrendsSummary {
  const endUtc = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
  const todayKey = toUtcDateKey(endUtc);

  const buckets: DailyDeliveryTrendPoint[] = [];
  const byDate: Record<string, DailyDeliveryTrendPoint> = {};

  for (let offset = 29; offset >= 0; offset--) {
    const d = new Date(endUtc.getTime() - offset * 86_400_000);
    const key = toUtcDateKey(d);
    const point: DailyDeliveryTrendPoint = {
      dateKey: key,
      label: formatDayLabel(key),
      deliveredCount: 0,
      pendingCount: 0,
      completedRevenuePkr: 0,
    };
    buckets.push(point);
    byDate[key] = point;
  }

  let totalDelivered30d = 0;
  let totalPending30d = 0;

  for (const order of orders) {
    if (order.status === "delivered") {
      const iso = order.delivered_at || order.created_at || todayKey;
      const parsed = new Date(iso);
      const key = Number.isNaN(parsed.getTime()) ? todayKey : toUtcDateKey(parsed);
      const bucket = byDate[key];
      if (bucket) {
        bucket.deliveredCount += 1;
        bucket.completedRevenuePkr += Number(order.total_amount || 0);
        totalDelivered30d += 1;
      }
    } else {
      const iso = order.created_at || todayKey;
      const parsed = new Date(iso);
      const key = Number.isNaN(parsed.getTime()) ? todayKey : toUtcDateKey(parsed);
      const bucket = byDate[key];
      if (bucket) {
        bucket.pendingCount += 1;
        totalPending30d += 1;
      }
    }
  }

  const totalOrders30d = totalDelivered30d + totalPending30d;
  const completionRatePct =
    totalOrders30d > 0 ? Math.round((totalDelivered30d / totalOrders30d) * 100) : 0;

  return {
    days: buckets,
    totalDelivered30d,
    totalPending30d,
    completionRatePct,
  };
}
