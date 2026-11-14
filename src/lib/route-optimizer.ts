import type { RouteStop } from "./data.ts";
import { resolveSalonCoordinates, type GeoPoint } from "./karachi-geo.ts";
import type { SalonWithApproval } from "../server/types.ts";

export interface OptimizedStopLeg {
  stop: RouteStop;
  point: GeoPoint;
  legDistanceKm: number;
  cumulativeDistanceKm: number;
}

export interface RouteOptimizationResult {
  origin: GeoPoint;
  originSource: "gps" | "depot_fallback";
  originLabel: string;
  optimizedRoute: RouteStop[];
  pendingLegs: OptimizedStopLeg[];
  originalPendingDistanceKm: number;
  optimizedPendingDistanceKm: number;
  savedKm: number;
  savedPct: number;
  hasChanges: boolean;
}

const EARTH_RADIUS_KM = 6371;
export const ROUTE_ORDER_STORAGE_KEY = "kiran_optimized_route_order_v1";

export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export function computeSequentialDistanceKm(
  origin: GeoPoint,
  points: readonly GeoPoint[],
): number {
  let total = 0;
  let cursor = origin;
  for (const pt of points) {
    total += haversineDistanceKm(cursor, pt);
    cursor = pt;
  }
  return Number(total.toFixed(2));
}

export function optimizeRouteStops(params: {
  route: readonly RouteStop[];
  salons: readonly SalonWithApproval[];
  origin: GeoPoint;
  originSource: "gps" | "depot_fallback";
  originLabel: string;
}): RouteOptimizationResult {
  const { route, salons, origin, originSource, originLabel } = params;
  const salonById: Record<string, SalonWithApproval> = {};
  for (const salon of salons) {
    salonById[salon.id] = salon;
  }

  const completedStops = route.filter((s) => s.status !== "pending");
  const pendingStops = route.filter((s) => s.status === "pending");

  const resolvedPoints = new Map<string, GeoPoint>();
  for (const stop of pendingStops) {
    const salon = salonById[stop.salon_id] ?? null;
    resolvedPoints.set(stop.id, resolveSalonCoordinates(salon, stop.id));
  }

  const originalPendingDistanceKm = computeSequentialDistanceKm(
    origin,
    pendingStops.map((s) => resolvedPoints.get(s.id)!),
  );

  // Greedy nearest-neighbor shortest-path sequence starting from current geolocation
  const remaining = [...pendingStops];
  const orderedPending: RouteStop[] = [];
  const pendingLegs: OptimizedStopLeg[] = [];
  let cursor = origin;
  let cumulative = 0;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const pt = resolvedPoints.get(candidate.id)!;
      const dist = haversineDistanceKm(cursor, pt);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0]!;
    const chosenPt = resolvedPoints.get(chosen.id)!;
    const legKm = Number(bestDist.toFixed(2));
    cumulative = Number((cumulative + bestDist).toFixed(2));

    orderedPending.push(chosen);
    pendingLegs.push({
      stop: chosen,
      point: chosenPt,
      legDistanceKm: legKm,
      cumulativeDistanceKm: cumulative,
    });
    cursor = chosenPt;
  }

  const optimizedPendingDistanceKm = Number(cumulative.toFixed(2));
  const savedKm = Math.max(
    0,
    Number((originalPendingDistanceKm - optimizedPendingDistanceKm).toFixed(2)),
  );
  const savedPct =
    originalPendingDistanceKm > 0
      ? Math.round((savedKm / originalPendingDistanceKm) * 100)
      : 0;

  const hasChanges = pendingStops.some(
    (stop, index) => orderedPending[index]?.id !== stop.id,
  );

  const merged = [...completedStops, ...orderedPending].map((stop, idx) => ({
    ...stop,
    stop_number: idx + 1,
  }));

  return {
    origin,
    originSource,
    originLabel,
    optimizedRoute: merged,
    pendingLegs,
    originalPendingDistanceKm,
    optimizedPendingDistanceKm,
    savedKm,
    savedPct,
    hasChanges,
  };
}

export function applyStoredRouteOrder(
  route: readonly RouteStop[],
  orderedIds: readonly string[] | null | undefined,
): RouteStop[] {
  if (!orderedIds || orderedIds.length === 0) {
    return route.map((stop, idx) => ({ ...stop, stop_number: idx + 1 }));
  }

  const rank = new Map<string, number>();
  orderedIds.forEach((id, idx) => rank.set(id, idx));

  const sorted = [...route].sort((a, b) => {
    const rankA = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const rankB = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.stop_number - b.stop_number;
  });

  return sorted.map((stop, idx) => ({ ...stop, stop_number: idx + 1 }));
}

export function savePreferredRouteOrder(route: readonly RouteStop[]): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      ROUTE_ORDER_STORAGE_KEY,
      JSON.stringify(route.map((stop) => stop.id)),
    );
  } catch {
    // Ignore storage errors
  }
}

export function loadPreferredRouteOrder(): string[] | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ROUTE_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : null;
  } catch {
    return null;
  }
}
