import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, FileText, ShieldCheck, X } from "lucide-react";
import {
  enumerateViewportTileCoords,
  projectBoundsCenterAndOrigin,
  projectLatLngToViewport,
  readCachedTileImage,
  TILE_SIZE,
  type OfflineRouteSnapshot,
} from "../lib/offline-map-cache";
import { getDeliveryPinStyle, type DeliveryMapStop } from "../lib/delivery-map-stops";
import type { DeliveryOrderFull } from "../server/types";

interface OfflineRouteMapProps {
  stops: DeliveryMapStop[];
  snapshot: OfflineRouteSnapshot;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
  onSelectDeliver: (orderId: string) => void;
  onViewReceipt: (order: DeliveryOrderFull) => void;
}

const KARACHI_REFERENCE_ZONES: Array<{ label: string; lat: number; lng: number }> = [
  { label: "Saddar", lat: 24.8556, lng: 67.0261 },
  { label: "Clifton", lat: 24.8138, lng: 67.0299 },
  { label: "DHA", lat: 24.7937, lng: 67.0644 },
  { label: "PECHS", lat: 24.8716, lng: 67.0598 },
  { label: "Gulshan", lat: 24.9204, lng: 67.0942 },
  { label: "Korangi", lat: 24.835, lng: 67.133 },
  { label: "Nazimabad", lat: 24.938, lng: 67.039 },
];

export const OfflineRouteMap: React.FC<OfflineRouteMapProps> = ({
  stops,
  snapshot,
  selectedOrderId,
  onSelectOrder,
  onSelectDeliver,
  onViewReceipt,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 720,
    height: 380,
  });
  const [renderedTileCount, setRenderedTileCount] = useState(0);

  const bounds = snapshot.bounds;
  const zoom = snapshot.zoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSize);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const projectedStops = useMemo(() => {
    return stops.map((stop) => {
      const pt = projectLatLngToViewport(
        stop.position.lat,
        stop.position.lng,
        bounds,
        zoom,
        size.width,
        size.height,
      );
      return {
        stop,
        x: Math.max(24, Math.min(size.width - 24, pt.x)),
        y: Math.max(24, Math.min(size.height - 24, pt.y)),
      };
    });
  }, [stops, bounds, zoom, size.width, size.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const draw = async () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size.width * dpr;
      canvas.height = size.height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      const isDark = document.documentElement.classList.contains("dark");
      ctx.fillStyle = isDark ? "#1a1715" : "#efe8e2";
      ctx.fillRect(0, 0, size.width, size.height);

      // Subtle offline cartographic graticule grid
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(122,46,74,0.08)";
      ctx.lineWidth = 1;
      for (let gx = 48; gx < size.width; gx += 64) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, size.height);
        ctx.stroke();
      }
      for (let gy = 48; gy < size.height; gy += 64) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(size.width, gy);
        ctx.stroke();
      }

      // Coastal band south of Clifton/DHA for spatial orientation
      const coastPt = projectLatLngToViewport(
        24.782,
        67.04,
        bounds,
        zoom,
        size.width,
        size.height,
      );
      if (coastPt.y < size.height) {
        ctx.fillStyle = isDark ? "rgba(30, 58, 76, 0.42)" : "rgba(186, 214, 228, 0.55)";
        ctx.fillRect(0, Math.max(0, coastPt.y), size.width, size.height - Math.max(0, coastPt.y));
      }

      // Draw cached OSM raster tiles aligned by exact Web Mercator world pixels
      const coords = enumerateViewportTileCoords(bounds, zoom, size.width, size.height);
      const { topLeftWorldX, topLeftWorldY } = projectBoundsCenterAndOrigin(
        bounds,
        zoom,
        size.width,
        size.height,
      );

      let tileHits = 0;
      const loadedTiles = await Promise.all(
        coords.map(async (coord) => ({
          coord,
          img: await readCachedTileImage(coord),
        })),
      );

      if (cancelled) return;

      for (const { coord, img } of loadedTiles) {
        if (!img) continue;
        tileHits += 1;
        const drawX = coord.x * TILE_SIZE - topLeftWorldX;
        const drawY = coord.y * TILE_SIZE - topLeftWorldY;
        ctx.drawImage(img, drawX, drawY, TILE_SIZE, TILE_SIZE);
      }
      setRenderedTileCount(tileHits);

      // Subtle tint over tiles in dark mode so pin contrast remains high
      if (tileHits > 0 && isDark) {
        ctx.fillStyle = "rgba(18, 15, 14, 0.25)";
        ctx.fillRect(0, 0, size.width, size.height);
      }

      // When raster tiles are absent (e.g., restricted offline start), paint Karachi zone labels
      if (tileHits === 0) {
        ctx.font = "600 11px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = isDark ? "rgba(218, 206, 200, 0.55)" : "rgba(107, 98, 94, 0.72)";
        ctx.textAlign = "center";
        for (const zone of KARACHI_REFERENCE_ZONES) {
          const zPt = projectLatLngToViewport(
            zone.lat,
            zone.lng,
            bounds,
            zoom,
            size.width,
            size.height,
          );
          if (zPt.x > 28 && zPt.x < size.width - 28 && zPt.y > 18 && zPt.y < size.height - 18) {
            ctx.fillText(zone.label.toUpperCase(), zPt.x, zPt.y);
          }
        }
      }

      // Draw dashed delivery route connector across pending stops (then delivered)
      const routeChain = [
        ...projectedStops.filter((p) => p.stop.order.status === "pending_delivery"),
        ...projectedStops.filter((p) => p.stop.order.status === "delivered"),
      ];

      if (routeChain.length >= 2) {
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = isDark ? "rgba(215, 122, 156, 0.85)" : "rgba(122, 46, 74, 0.82)";
        routeChain.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    };

    void draw();
    return () => {
      cancelled = true;
    };
  }, [bounds, zoom, size.width, size.height, projectedStops]);

  const selectedEntry = useMemo(
    () => projectedStops.find((entry) => entry.stop.order.id === selectedOrderId) ?? null,
    [projectedStops, selectedOrderId],
  );

  return (
    <div
      ref={containerRef}
      data-testid="offline-route-map-container"
      data-cached-tiles={renderedTileCount}
      className="relative w-full h-full select-none overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        data-testid="offline-route-map-canvas"
        className="w-full h-full block"
      />

      {/* Interactive Pin Layer */}
      {projectedStops.map(({ stop, x, y }) => {
        const isDelivered = stop.order.status === "delivered";
        const isSelected = selectedOrderId === stop.order.id;
        const pinStyle = getDeliveryPinStyle(stop.order.status, isSelected);

        return (
          <button
            key={stop.order.id}
            type="button"
            data-testid={`offline-pin-${stop.order.id}`}
            aria-label={`${pinStyle.label}: ${stop.order.salon_name} (${stop.order.order_number})`}
            aria-pressed={isSelected}
            onClick={() => onSelectOrder(isSelected ? null : stop.order.id)}
            style={{
              left: `${(x / size.width) * 100}%`,
              top: `${(y / size.height) * 100}%`,
              backgroundColor: pinStyle.background,
              borderColor: pinStyle.borderColor,
              color: pinStyle.glyphColor,
            }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md flex items-center justify-center transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a2e4a] ${
              isSelected
                ? "w-9 h-9 scale-110 z-30"
                : isDelivered
                  ? "w-7 h-7 z-10 hover:scale-105"
                  : "w-8 h-8 z-20 hover:scale-105"
            }`}
          >
            {isDelivered ? (
              <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
            ) : (
              <Clock className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            )}
          </button>
        );
      })}

      {/* Selected Stop Tracking Card */}
      {selectedEntry && (
        <div
          role="region"
          aria-label={`Selected stop ${selectedEntry.stop.order.salon_name}`}
          className="absolute left-3 right-3 sm:left-auto sm:right-3 bottom-7 sm:w-72 z-40 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-lg p-3 space-y-2 text-[#1d1a19] dark:text-[#f2eeec]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="font-mono text-[#6b625e] dark:text-[#a59b96]">
                  {selectedEntry.stop.order.order_number}
                </span>
                <span aria-hidden="true" className="text-[#6b625e]">
                  ·
                </span>
                <span
                  className={`font-semibold ${
                    selectedEntry.stop.order.status === "delivered"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {selectedEntry.stop.order.status === "delivered"
                    ? "Delivered"
                    : "Pending Delivery"}
                </span>
              </div>
              <div className="font-bold text-xs truncate mt-0.5">
                {selectedEntry.stop.order.salon_name}
              </div>
              <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] truncate">
                {selectedEntry.stop.address}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close stop details"
              onClick={() => onSelectOrder(null)}
              className="p-1 rounded-lg hover:bg-[#faf7f5] dark:hover:bg-[#171413] text-[#6b625e]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="text-[11px] bg-[#faf7f5] dark:bg-[#171413] p-2 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330]">
            <div className="text-[#6b625e] dark:text-[#a59b96] truncate">
              {selectedEntry.stop.order.items
                .map((i) => `${i.qty}x ${i.sku_name}`)
                .join(", ")}
            </div>
            {selectedEntry.stop.order.notes && (
              <div className="mt-1 text-[#7a2e4a] dark:text-[#d77a9c] line-clamp-2">
                Note: {selectedEntry.stop.order.notes}
              </div>
            )}
            <div className="font-bold text-[#7a2e4a] dark:text-[#d77a9c] mt-1 tabular-nums">
              Total: PKR {selectedEntry.stop.order.total_amount.toLocaleString()}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {selectedEntry.stop.order.status !== "delivered" && (
              <button
                type="button"
                onClick={() => onSelectDeliver(selectedEntry.stop.order.id)}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center justify-center gap-1 whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Deliver</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onViewReceipt(selectedEntry.stop.order)}
              className={`${
                selectedEntry.stop.order.status === "delivered"
                  ? "w-full justify-center"
                  : ""
              } px-2.5 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Receipt</span>
            </button>
          </div>
        </div>
      )}

      {/* Map Attribution Footer */}
      <div className="absolute bottom-1.5 right-2 px-2 py-0.5 rounded bg-white/85 dark:bg-[#211d1b]/85 text-[10px] text-[#6b625e] dark:text-[#a59b96] border border-[#e6dfdb]/70 dark:border-[#3a3330]">
        {renderedTileCount > 0
          ? `Cached Map (${renderedTileCount} tiles) · © OpenStreetMap contributors`
          : "Cached Offline Route Schematic · Karachi"}
      </div>
    </div>
  );
};
