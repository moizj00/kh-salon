import type { DeliveryMapStop } from "./delivery-map-stops.ts";
import { KARACHI_DEFAULT_CENTER, type GeoPoint } from "./karachi-geo.ts";

export const MAP_TILE_CACHE_NAME = "kiran-map-tiles-v1";
export const OFFLINE_ROUTE_STORAGE_KEY = "kiran_offline_route_snapshot_v1";
export const MAX_ROUTE_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (GMP geospatial caching cap)
export const TILE_SIZE = 256;

export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface CachedStopSnapshot {
  orderId: string;
  orderNumber: string;
  salonId: string;
  salonName: string;
  status: "pending_delivery" | "delivered";
  deliveredAt: string | null;
  totalAmount: number;
  notes: string | null;
  area: string;
  address: string;
  phone: string;
  itemsSummary: string;
  lat: number;
  lng: number;
  pendingStopNumber: number | null;
}

export interface OfflineRouteSnapshot {
  version: 1;
  savedAt: string;
  expiresAt: string;
  bounds: GeoBounds;
  zoom: number;
  cachedTileCount: number;
  stops: CachedStopSnapshot[];
}

export function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

export function latLngToWorldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const clamped = clampLat(lat);
  const sinLat = Math.sin((clamped * Math.PI) / 180);
  const x = ((lng + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function latLngToTile(lat: number, lng: number, zoom: number): TileCoord {
  const world = latLngToWorldPixel(lat, lng, zoom);
  const maxTile = 2 ** zoom - 1;
  return {
    z: zoom,
    x: Math.max(0, Math.min(maxTile, Math.floor(world.x / TILE_SIZE))),
    y: Math.max(0, Math.min(maxTile, Math.floor(world.y / TILE_SIZE))),
  };
}

export function computeRouteBounds(points: readonly GeoPoint[]): GeoBounds {
  if (points.length === 0) {
    return {
      south: KARACHI_DEFAULT_CENTER.lat - 0.03,
      north: KARACHI_DEFAULT_CENTER.lat + 0.03,
      west: KARACHI_DEFAULT_CENTER.lng - 0.04,
      east: KARACHI_DEFAULT_CENTER.lng + 0.04,
    };
  }

  let south = points[0]!.lat;
  let north = points[0]!.lat;
  let west = points[0]!.lng;
  let east = points[0]!.lng;

  for (const pt of points) {
    if (pt.lat < south) south = pt.lat;
    if (pt.lat > north) north = pt.lat;
    if (pt.lng < west) west = pt.lng;
    if (pt.lng > east) east = pt.lng;
  }

  // Add breathing padding so edge pins aren't clipped
  const latSpan = Math.max(0.015, north - south);
  const lngSpan = Math.max(0.02, east - west);
  const padLat = latSpan * 0.22;
  const padLng = lngSpan * 0.22;

  return {
    south: Number((south - padLat).toFixed(5)),
    north: Number((north + padLat).toFixed(5)),
    west: Number((west - padLng).toFixed(5)),
    east: Number((east + padLng).toFixed(5)),
  };
}

export function selectOptimalTileZoom(
  bounds: GeoBounds,
  viewportWidth = 720,
  viewportHeight = 380,
): number {
  for (let z = 14; z >= 10; z--) {
    const sw = latLngToWorldPixel(bounds.south, bounds.west, z);
    const ne = latLngToWorldPixel(bounds.north, bounds.east, z);
    const widthPx = Math.abs(ne.x - sw.x);
    const heightPx = Math.abs(sw.y - ne.y);
    if (widthPx <= viewportWidth * 0.85 && heightPx <= viewportHeight * 0.85) {
      return z;
    }
  }
  return 10;
}

export function enumerateRouteTileCoords(
  bounds: GeoBounds,
  zoom: number,
  paddingTiles = 2,
  maxTiles = 42,
): TileCoord[] {
  const nw = latLngToTile(bounds.north, bounds.west, zoom);
  const se = latLngToTile(bounds.south, bounds.east, zoom);
  const maxIndex = 2 ** zoom - 1;

  const minX = Math.max(0, nw.x - paddingTiles);
  const maxX = Math.min(maxIndex, se.x + paddingTiles);
  const minY = Math.max(0, nw.y - paddingTiles);
  const maxY = Math.min(maxIndex, se.y + paddingTiles);

  const coords: TileCoord[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      coords.push({ z: zoom, x, y });
      if (coords.length >= maxTiles) return coords;
    }
  }
  return coords;
}

export function enumerateViewportTileCoords(
  bounds: GeoBounds,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): TileCoord[] {
  const { topLeftWorldX, topLeftWorldY } = projectBoundsCenterAndOrigin(
    bounds,
    zoom,
    viewportWidth,
    viewportHeight,
  );
  const maxIndex = 2 ** zoom - 1;
  const minX = Math.max(0, Math.floor(topLeftWorldX / TILE_SIZE));
  const maxX = Math.min(maxIndex, Math.floor((topLeftWorldX + viewportWidth) / TILE_SIZE));
  const minY = Math.max(0, Math.floor(topLeftWorldY / TILE_SIZE));
  const maxY = Math.min(maxIndex, Math.floor((topLeftWorldY + viewportHeight) / TILE_SIZE));

  const coords: TileCoord[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      coords.push({ z: zoom, x, y });
    }
  }
  return coords;
}

export function buildTileUrl(coord: TileCoord): string {
  return `https://tile.openstreetmap.org/${coord.z}/${coord.x}/${coord.y}.png`;
}

export function projectBoundsCenterAndOrigin(
  bounds: GeoBounds,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): { topLeftWorldX: number; topLeftWorldY: number } {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLng = (bounds.west + bounds.east) / 2;
  const centerWorld = latLngToWorldPixel(centerLat, centerLng, zoom);
  return {
    topLeftWorldX: centerWorld.x - viewportWidth / 2,
    topLeftWorldY: centerWorld.y - viewportHeight / 2,
  };
}

export function projectLatLngToViewport(
  lat: number,
  lng: number,
  bounds: GeoBounds,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const world = latLngToWorldPixel(lat, lng, zoom);
  const { topLeftWorldX, topLeftWorldY } = projectBoundsCenterAndOrigin(
    bounds,
    zoom,
    viewportWidth,
    viewportHeight,
  );
  return {
    x: world.x - topLeftWorldX,
    y: world.y - topLeftWorldY,
  };
}

export function buildOfflineRouteSnapshot(
  stops: readonly DeliveryMapStop[],
  cachedTileCount = 0,
  now = new Date(),
): OfflineRouteSnapshot {
  const bounds = computeRouteBounds(stops.map((s) => s.position));
  const zoom = selectOptimalTileZoom(bounds);
  const expiresAt = new Date(now.getTime() + MAX_ROUTE_CACHE_AGE_MS).toISOString();

  return {
    version: 1,
    savedAt: now.toISOString(),
    expiresAt,
    bounds,
    zoom,
    cachedTileCount,
    stops: stops.map((s) => ({
      orderId: s.order.id,
      orderNumber: s.order.order_number,
      salonId: s.order.salon_id,
      salonName: s.order.salon_name,
      status: s.order.status,
      deliveredAt: s.order.delivered_at,
      totalAmount: s.order.total_amount,
      notes: s.order.notes ?? null,
      area: s.area,
      address: s.address,
      phone: s.phone,
      itemsSummary: s.order.items.map((i) => `${i.qty}x ${i.sku_name}`).join(", "),
      lat: s.position.lat,
      lng: s.position.lng,
      pendingStopNumber: s.pendingStopNumber,
    })),
  };
}

export function isOfflineSnapshotExpired(
  snapshot: OfflineRouteSnapshot,
  now = new Date(),
): boolean {
  const exp = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(exp)) return true;
  return now.getTime() > exp;
}

export function saveOfflineRouteSnapshot(snapshot: OfflineRouteSnapshot): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(OFFLINE_ROUTE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota errors
  }
}

export function loadOfflineRouteSnapshot(now = new Date()): OfflineRouteSnapshot | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(OFFLINE_ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineRouteSnapshot;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.stops) ||
      isOfflineSnapshotExpired(parsed, now)
    ) {
      localStorage.removeItem(OFFLINE_ROUTE_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function prefetchRouteTiles(
  stops: readonly DeliveryMapStop[],
  options: { timeoutMs?: number } = {},
): Promise<{ cachedCount: number; targetCount: number }> {
  if (typeof window === "undefined" || stops.length === 0) {
    return { cachedCount: 0, targetCount: 0 };
  }

  const bounds = computeRouteBounds(stops.map((s) => s.position));
  const primaryZoom = selectOptimalTileZoom(bounds);
  const tileCoords = enumerateRouteTileCoords(bounds, primaryZoom, 2, 42);
  const urls = tileCoords.map(buildTileUrl);

  if (!("caches" in window)) {
    return { cachedCount: 0, targetCount: urls.length };
  }

  // Notify active Service Worker as well
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "PREFETCH_MAP_TILES",
      urls,
    });
  }

  const cache = await caches.open(MAP_TILE_CACHE_NAME);
  let cachedCount = 0;
  const timeoutMs = options.timeoutMs ?? 3500;

  await Promise.all(
    urls.map(async (url) => {
      try {
        const existing = await cache.match(url);
        if (existing) {
          cachedCount += 1;
          return;
        }
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          return;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, {
            mode: "cors",
            credentials: "omit",
            signal: controller.signal,
          });
          if (response.ok) {
            await cache.put(url, response.clone());
            cachedCount += 1;
          }
        } finally {
          window.clearTimeout(timer);
        }
      } catch {
        // Offline or network blocked; cached count stays accurate
      }
    }),
  );

  return { cachedCount, targetCount: urls.length };
}

export async function countCachedTilesForBounds(
  bounds: GeoBounds,
  zoom: number,
): Promise<number> {
  if (typeof window === "undefined" || !("caches" in window)) return 0;
  try {
    const cache = await caches.open(MAP_TILE_CACHE_NAME);
    const coords = enumerateRouteTileCoords(bounds, zoom, 2, 42);
    let hits = 0;
    await Promise.all(
      coords.map(async (c) => {
        const hit = await cache.match(buildTileUrl(c));
        if (hit) hits += 1;
      }),
    );
    return hits;
  } catch {
    return 0;
  }
}

export async function readCachedTileImage(coord: TileCoord): Promise<HTMLImageElement | null> {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  try {
    const cache = await caches.open(MAP_TILE_CACHE_NAME);
    const res = await cache.match(buildTileUrl(coord));
    if (!res) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      img.src = objectUrl;
    });
  } catch {
    return null;
  }
}
