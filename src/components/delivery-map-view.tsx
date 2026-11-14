import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdvancedMarker,
  APIProvider,
  APILoadingStatus,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
} from "@vis.gl/react-google-maps";
import {
  Check,
  Clock,
  FileText,
  HardDriveDownload,
  List,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { fetchMapsConfig } from "../lib/api";
import {
  buildDeliveryMapStops,
  getDeliveryPinStyle,
  type DeliveryMapStop,
} from "../lib/delivery-map-stops";
import { KARACHI_DEFAULT_CENTER } from "../lib/karachi-geo";
import {
  buildOfflineRouteSnapshot,
  countCachedTilesForBounds,
  loadOfflineRouteSnapshot,
  prefetchRouteTiles,
  saveOfflineRouteSnapshot,
  type OfflineRouteSnapshot,
} from "../lib/offline-map-cache";
import { when } from "../lib/time";
import type { DeliveryOrderFull, SalonWithApproval } from "../server/types";
import { OfflineRouteMap } from "./offline-route-map";

interface DeliveryMapViewProps {
  orders: DeliveryOrderFull[];
  salons: SalonWithApproval[];
  onSelectDeliver: (orderId: string) => void;
  onViewReceipt: (order: DeliveryOrderFull) => void;
  onSwitchToList: () => void;
}

const MapStatusObserver: React.FC<{ onStatusChange: (status: APILoadingStatus) => void }> = ({
  onStatusChange,
}) => {
  const status = useApiLoadingStatus();
  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);
  return null;
};

const MapViewportController: React.FC<{
  stops: DeliveryMapStop[];
  selectedOrderId: string | null;
}> = ({ stops, selectedOrderId }) => {
  const map = useMap();

  useEffect(() => {
    if (!map || stops.length === 0) return;
    if (stops.length === 1) {
      map.panTo(stops[0].position);
      map.setZoom(13);
      return;
    }
    let south = stops[0].position.lat;
    let north = stops[0].position.lat;
    let west = stops[0].position.lng;
    let east = stops[0].position.lng;
    for (const stop of stops) {
      if (stop.position.lat < south) south = stop.position.lat;
      if (stop.position.lat > north) north = stop.position.lat;
      if (stop.position.lng < west) west = stop.position.lng;
      if (stop.position.lng > east) east = stop.position.lng;
    }
    map.fitBounds(
      { south, west, north, east },
      { top: 48, right: 48, bottom: 48, left: 48 },
    );
  }, [map, stops]);

  useEffect(() => {
    if (!map || !selectedOrderId) return;
    const target = stops.find((s) => s.order.id === selectedOrderId);
    if (target) {
      map.panTo(target.position);
    }
  }, [map, selectedOrderId, stops]);

  return null;
};

const DeliveryStopMarker: React.FC<{
  stop: DeliveryMapStop;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onSelectDeliver: (orderId: string) => void;
  onViewReceipt: (order: DeliveryOrderFull) => void;
}> = ({ stop, isSelected, onSelect, onClose, onSelectDeliver, onViewReceipt }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const isDelivered = stop.order.status === "delivered";
  const pinStyle = getDeliveryPinStyle(stop.order.status, isSelected);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={stop.position}
        title={`${stop.order.salon_name} (${stop.order.order_number}) — ${pinStyle.label}`}
        zIndex={isSelected ? 30 : isDelivered ? 10 : 20}
        onClick={onSelect}
      >
        <Pin
          background={pinStyle.background}
          borderColor={pinStyle.borderColor}
          glyphColor={pinStyle.glyphColor}
          scale={isSelected ? 1.2 : isDelivered ? 0.98 : 1.08}
        >
          {isDelivered ? (
            <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />
          ) : (
            <Clock className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
          )}
        </Pin>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={270} onCloseClick={onClose}>
          <div className="p-1 text-[#1d1a19] space-y-2 min-w-[215px]">
            <div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-[#6b625e]">{stop.order.order_number}</span>
                <span
                  className={`font-semibold inline-flex items-center gap-1 ${
                    isDelivered ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {isDelivered ? (
                    <Check className="w-3 h-3" strokeWidth={2.5} />
                  ) : (
                    <Clock className="w-3 h-3" strokeWidth={2.5} />
                  )}
                  <span>{pinStyle.label}</span>
                </span>
              </div>
              <div className="font-bold text-sm leading-tight mt-0.5">{stop.order.salon_name}</div>
              <div className="text-xs text-[#6b625e] mt-0.5">{stop.address}</div>
              {stop.phone && (
                <div className="text-[11px] text-[#6b625e] mt-0.5">Tel: {stop.phone}</div>
              )}
            </div>

            <div className="text-xs bg-[#faf7f5] p-2 rounded-lg border border-[#e6dfdb]">
              <div className="text-[#6b625e]">
                {stop.order.items.map((i) => `${i.qty}x ${i.sku_name}`).join(", ")}
              </div>
              {stop.order.notes && (
                <div className="text-[11px] text-[#1d1a19] mt-1 pt-1 border-t border-[#e6dfdb]">
                  Note: {stop.order.notes}
                </div>
              )}
              <div className="font-bold text-[#7a2e4a] mt-1 tabular-nums">
                Total: PKR {stop.order.total_amount.toLocaleString()}
              </div>
              {isDelivered && stop.order.delivered_at && (
                <div className="text-[11px] text-emerald-700 mt-1">
                  Delivered {when(stop.order.delivered_at)}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 pt-0.5">
              {!isDelivered && (
                <button
                  type="button"
                  onClick={() => onSelectDeliver(stop.order.id)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Deliver</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onViewReceipt(stop.order)}
                className={`${isDelivered ? "w-full justify-center" : ""} px-2.5 py-1.5 rounded-lg border border-[#e6dfdb] text-[#1d1a19] text-xs font-semibold flex items-center gap-1`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Receipt</span>
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

function snapshotStopsToMapStops(
  snapshot: OfflineRouteSnapshot,
  salons: readonly SalonWithApproval[],
): DeliveryMapStop[] {
  const salonLookup: Record<string, SalonWithApproval> = {};
  for (const s of salons) {
    salonLookup[s.id] = s;
  }

  return snapshot.stops.map((s) => ({
    order: {
      id: s.orderId,
      order_number: s.orderNumber,
      salon_id: s.salonId,
      salon_name: s.salonName,
      items: s.itemsSummary
        ? [{ sku_name: s.itemsSummary, qty: 1, price: s.totalAmount }]
        : [],
      total_amount: s.totalAmount,
      status: s.status,
      delivered_at: s.deliveredAt,
      notes: s.notes,
    },
    salon: salonLookup[s.salonId] ?? null,
    position: { lat: s.lat, lng: s.lng },
    area: s.area,
    address: s.address,
    phone: s.phone,
    pendingStopNumber: s.pendingStopNumber,
  }));
}

export const DeliveryMapView: React.FC<DeliveryMapViewProps> = ({
  orders,
  salons,
  onSelectDeliver,
  onViewReceipt,
  onSwitchToList,
}) => {
  const envKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || "";
  const [apiKey, setApiKey] = useState<string>(envKey);
  const [keyLoading, setKeyLoading] = useState<boolean>(!envKey);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<APILoadingStatus>(APILoadingStatus.NOT_LOADED);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [cachedSnapshot, setCachedSnapshot] = useState<OfflineRouteSnapshot | null>(() =>
    loadOfflineRouteSnapshot(),
  );
  const [cachingTiles, setCachingTiles] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (envKey) {
      setApiKey(envKey);
      setKeyLoading(false);
      return;
    }
    if (!isBrowserOnline) {
      setKeyLoading(false);
      return;
    }
    let mounted = true;
    fetchMapsConfig()
      .then((cfg) => {
        if (mounted) {
          setApiKey((cfg.apiKey || "").trim());
        }
      })
      .catch(() => {
        // Handled cleanly via !apiKey / offline fallback
      })
      .finally(() => {
        if (mounted) setKeyLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [envKey, isBrowserOnline]);

  const liveStops: DeliveryMapStop[] = useMemo(
    () => buildDeliveryMapStops(orders, salons),
    [orders, salons],
  );

  // When offline with an existing snapshot and empty live orders (cold offline start), fall back to cached stops
  const stops: DeliveryMapStop[] = useMemo(() => {
    if (liveStops.length > 0) return liveStops;
    if (!isBrowserOnline && cachedSnapshot && cachedSnapshot.stops.length > 0) {
      return snapshotStopsToMapStops(cachedSnapshot, salons);
    }
    return [];
  }, [liveStops, isBrowserOnline, cachedSnapshot, salons]);

  const cacheRouteOffline = useCallback(
    async (targetStops: DeliveryMapStop[]) => {
      if (targetStops.length === 0) return;
      setCachingTiles(true);
      try {
        const draftSnapshot = buildOfflineRouteSnapshot(targetStops, 0);
        const { cachedCount } = await prefetchRouteTiles(targetStops);
        const existingHits =
          cachedCount > 0
            ? cachedCount
            : await countCachedTilesForBounds(draftSnapshot.bounds, draftSnapshot.zoom);
        const finalized = buildOfflineRouteSnapshot(targetStops, existingHits);
        saveOfflineRouteSnapshot(finalized);
        setCachedSnapshot(finalized);
      } finally {
        setCachingTiles(false);
      }
    },
    [],
  );

  // Automatically save & prefetch route tiles whenever stops are viewed online
  useEffect(() => {
    if (!isBrowserOnline || liveStops.length === 0) return;
    void cacheRouteOffline(liveStops);
  }, [isBrowserOnline, liveStops, cacheRouteOffline]);

  const pendingCount = useMemo(
    () => stops.filter((s) => s.order.status === "pending_delivery").length,
    [stops],
  );
  const deliveredCount = stops.length - pendingCount;

  useEffect(() => {
    if (stops.length === 0) {
      setSelectedOrderId(null);
      return;
    }
    if (selectedOrderId && !stops.some((s) => s.order.id === selectedOrderId)) {
      setSelectedOrderId(null);
    }
  }, [stops, selectedOrderId]);

  if (stops.length === 0) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-[#211d1b] border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center space-y-3">
        <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
            No Delivery Locations Found
          </h3>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
            No delivery orders match the current filter to display on the map.
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitchToList}
          className="px-4 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold inline-flex items-center gap-1.5"
        >
          <List className="w-3.5 h-3.5" />
          <span>Back to List View</span>
        </button>
      </div>
    );
  }

  const mapLoadFailed =
    apiStatus === APILoadingStatus.FAILED || apiStatus === APILoadingStatus.AUTH_FAILURE;
  const useOfflineCachedMap = !isBrowserOnline || mapLoadFailed || !apiKey;
  const activeSnapshot =
    cachedSnapshot ?? buildOfflineRouteSnapshot(stops, 0);

  return (
    <div className="space-y-3" data-testid="deliveries-route-map-panel">
      {/* Map Container */}
      <div className="rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] overflow-hidden shadow-xs">
        <div className="px-4 py-2.5 border-b border-[#e6dfdb] dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {useOfflineCachedMap ? (
              <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : (
              <MapPin className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c] shrink-0" />
            )}
            <span className="font-bold text-[#1d1a19] dark:text-[#f2eeec] tabular-nums">
              Delivery Route Pins ({stops.length})
            </span>
            <span aria-hidden="true" className="text-[#6b625e] dark:text-[#a59b96]">
              ·
            </span>
            {useOfflineCachedMap ? (
              <span
                data-testid="map-offline-cache-status"
                className="text-[11px] font-medium text-amber-700 dark:text-amber-300 tabular-nums"
              >
                {!isBrowserOnline ? "Offline Cached Route" : "Cached Route View"}
                {cachedSnapshot?.savedAt ? ` · Saved ${when(cachedSnapshot.savedAt)}` : ""}
              </span>
            ) : (
              <span
                data-testid="map-offline-cache-status"
                className="text-[11px] text-[#6b625e] dark:text-[#a59b96] inline-flex items-center gap-1 tabular-nums"
              >
                <HardDriveDownload className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>
                  {cachingTiles
                    ? "Caching offline tiles..."
                    : cachedSnapshot
                      ? `Offline ready (${cachedSnapshot.cachedTileCount} tiles)`
                      : "Route cached"}
                </span>
                <button
                  type="button"
                  onClick={() => void cacheRouteOffline(liveStops)}
                  disabled={cachingTiles}
                  aria-label="Refresh offline map cache"
                  title="Refresh offline map cache"
                  className="ml-0.5 p-1 rounded hover:bg-[#faf7f5] dark:hover:bg-[#171413] text-[#7a2e4a] dark:text-[#d77a9c] disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${cachingTiles ? "animate-spin" : ""}`} />
                </button>
              </span>
            )}
          </div>

          <div
            aria-label="Delivery pin legend"
            className="flex flex-wrap items-center gap-3 text-[11px] font-medium tabular-nums"
          >
            <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <span className="w-4 h-4 rounded-full bg-amber-600 text-white inline-flex items-center justify-center shrink-0">
                <Clock className="w-2.5 h-2.5" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <span>Pending ({pendingCount})</span>
            </span>
            <span aria-hidden="true" className="text-[#6b625e] dark:text-[#a59b96]">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white inline-flex items-center justify-center shrink-0">
                <Check className="w-2.5 h-2.5" strokeWidth={3} aria-hidden="true" />
              </span>
              <span>Delivered ({deliveredCount})</span>
            </span>
          </div>
        </div>

        <div className="h-[360px] sm:h-[420px] w-full relative bg-[#f3ede9] dark:bg-[#1b1716]">
          {keyLoading && isBrowserOnline ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-[#6b625e] dark:text-[#a59b96]">
              Loading Karachi delivery route map...
            </div>
          ) : useOfflineCachedMap ? (
            <OfflineRouteMap
              stops={stops}
              snapshot={activeSnapshot}
              selectedOrderId={selectedOrderId}
              onSelectOrder={setSelectedOrderId}
              onSelectDeliver={onSelectDeliver}
              onViewReceipt={onViewReceipt}
            />
          ) : (
            <APIProvider apiKey={apiKey} libraries={["marker"]} language="en" region="PK">
              <MapStatusObserver onStatusChange={setApiStatus} />
              <GoogleMap
                mapId="DEMO_MAP_ID"
                defaultCenter={KARACHI_DEFAULT_CENTER}
                defaultZoom={12}
                gestureHandling="greedy"
                internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
                style={{ width: "100%", height: "100%" }}
              >
                <MapViewportController stops={stops} selectedOrderId={selectedOrderId} />
                {stops.map((stop) => (
                  <DeliveryStopMarker
                    key={stop.order.id}
                    stop={stop}
                    isSelected={selectedOrderId === stop.order.id}
                    onSelect={() => setSelectedOrderId(stop.order.id)}
                    onClose={() => setSelectedOrderId(null)}
                    onSelectDeliver={onSelectDeliver}
                    onViewReceipt={onViewReceipt}
                  />
                ))}
              </GoogleMap>
            </APIProvider>
          )}
        </div>
      </div>

      {/* Synchronized Delivery Stops Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {stops.map((stop) => {
          const isSelected = selectedOrderId === stop.order.id;
          const isDelivered = stop.order.status === "delivered";

          return (
            <div
              key={stop.order.id}
              data-pin-status={stop.order.status}
              className={`p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border transition-colors space-y-2.5 ${
                isSelected
                  ? "border-[#7a2e4a] dark:border-[#d77a9c] shadow-xs"
                  : "border-[#e6dfdb] dark:border-[#3a3330]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrderId(stop.order.id)}
                  className="flex items-start gap-2.5 text-left min-w-0 flex-1"
                >
                  <span
                    aria-label={isDelivered ? "Delivered order pin" : "Pending delivery pin"}
                    className={`w-6 h-6 rounded-full text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 ${
                      isDelivered ? "bg-emerald-600" : "bg-amber-600"
                    }`}
                  >
                    {isDelivered ? (
                      <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-mono text-[#6b625e] dark:text-[#a59b96]">
                        {stop.order.order_number} · {stop.area}
                      </span>
                      <span
                        className={`font-semibold ${
                          isDelivered
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        · {isDelivered ? "Delivered" : "Pending"}
                      </span>
                    </div>
                    <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] truncate">
                      {stop.order.salon_name}
                    </div>
                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] truncate">
                      {stop.address}
                    </div>
                    {stop.order.notes && (
                      <div className="text-[11px] text-[#7a2e4a] dark:text-[#d77a9c] mt-0.5 line-clamp-2">
                        Note: {stop.order.notes}
                      </div>
                    )}
                  </div>
                </button>

                <div className="text-right shrink-0">
                  <div className="font-bold text-xs text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                    PKR {stop.order.total_amount.toLocaleString()}
                  </div>
                  <div className="text-[10px] font-mono text-[#6b625e] dark:text-[#a59b96] tabular-nums mt-0.5">
                    {stop.position.lat.toFixed(3)}, {stop.position.lng.toFixed(3)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e6dfdb]/60 dark:border-[#3a3330]">
                {isDelivered && stop.order.delivered_at ? (
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                    Delivered {when(stop.order.delivered_at)}
                  </span>
                ) : stop.phone ? (
                  <a
                    href={`tel:${stop.phone}`}
                    className="text-xs text-[#6b625e] dark:text-[#a59b96] hover:text-[#7a2e4a] inline-flex items-center gap-1"
                  >
                    <Phone className="w-3 h-3" />
                    <span className="tabular-nums">{stop.phone}</span>
                  </a>
                ) : (
                  <span className="text-xs text-[#6b625e] dark:text-[#a59b96]">Karachi Route</span>
                )}

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onViewReceipt(stop.order)}
                    className="px-2.5 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a] whitespace-nowrap shrink-0"
                  >
                    Receipt
                  </button>
                  {!isDelivered && (
                    <button
                      type="button"
                      onClick={() => onSelectDeliver(stop.order.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 hover:opacity-95"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Deliver &amp; Sign</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
