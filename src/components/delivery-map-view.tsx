import React, { useEffect, useMemo, useState } from "react";
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
import { FileText, List, MapPin, Phone, ShieldCheck } from "lucide-react";
import { fetchMapsConfig } from "../lib/api";
import { KARACHI_DEFAULT_CENTER, resolveSalonCoordinates, type GeoPoint } from "../lib/karachi-geo";
import type { DeliveryOrderFull, SalonWithApproval } from "../server/types";

interface PendingStop {
  stopIndex: number;
  order: DeliveryOrderFull;
  salon: SalonWithApproval | null;
  position: GeoPoint;
  area: string;
  address: string;
  phone: string;
}

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
  stops: PendingStop[];
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

const PendingDeliveryMarker: React.FC<{
  stop: PendingStop;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onSelectDeliver: (orderId: string) => void;
  onViewReceipt: (order: DeliveryOrderFull) => void;
}> = ({ stop, isSelected, onSelect, onClose, onSelectDeliver, onViewReceipt }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={stop.position}
        title={`${stop.order.salon_name} (${stop.order.order_number})`}
        zIndex={isSelected ? 20 : 10}
        onClick={onSelect}
      >
        <Pin
          background={isSelected ? "#5a1e34" : "#7a2e4a"}
          borderColor="#ffffff"
          glyphColor="#ffffff"
          glyph={String(stop.stopIndex)}
          scale={isSelected ? 1.2 : 1.05}
        />
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={270} onCloseClick={onClose}>
          <div className="p-1 text-[#1d1a19] space-y-2 min-w-[210px]">
            <div>
              <div className="text-[11px] font-mono text-[#6b625e]">
                Stop #{stop.stopIndex} · {stop.order.order_number}
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
              <div className="font-bold text-[#7a2e4a] mt-1 tabular-nums">
                Total: PKR {stop.order.total_amount.toLocaleString()}
              </div>
            </div>

            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => onSelectDeliver(stop.order.id)}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center justify-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Deliver</span>
              </button>
              <button
                type="button"
                onClick={() => onViewReceipt(stop.order)}
                className="px-2.5 py-1.5 rounded-lg border border-[#e6dfdb] text-[#1d1a19] text-xs font-semibold flex items-center gap-1"
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

  useEffect(() => {
    if (envKey) {
      setApiKey(envKey);
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
        // Handled cleanly via !apiKey fallback state
      })
      .finally(() => {
        if (mounted) setKeyLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [envKey]);

  const salonLookup = useMemo(() => {
    const dict: Record<string, SalonWithApproval> = {};
    for (const s of salons) {
      dict[s.id] = s;
    }
    return dict;
  }, [salons]);

  const pendingStops: PendingStop[] = useMemo(() => {
    return orders
      .filter((o) => o.status === "pending_delivery")
      .map((order, idx) => {
        const salon = salonLookup[order.salon_id] ?? null;
        const position = resolveSalonCoordinates(salon, order.id);
        return {
          stopIndex: idx + 1,
          order,
          salon,
          position,
          area: salon?.area || "Karachi",
          address: salon?.address || `${salon?.area || "Karachi"}, Karachi`,
          phone: salon?.phone || "",
        };
      });
  }, [orders, salonLookup]);

  useEffect(() => {
    if (pendingStops.length === 0) {
      setSelectedOrderId(null);
      return;
    }
    if (selectedOrderId && !pendingStops.some((s) => s.order.id === selectedOrderId)) {
      setSelectedOrderId(null);
    }
  }, [pendingStops, selectedOrderId]);

  if (pendingStops.length === 0) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-[#211d1b] border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center space-y-3">
        <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
            All Deliveries Completed
          </h3>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
            No pending delivery locations left to route on the map.
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

  return (
    <div className="space-y-3" data-testid="deliveries-route-map-panel">
      {/* Map Container */}
      <div className="rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] overflow-hidden shadow-xs">
        <div className="px-4 py-2.5 border-b border-[#e6dfdb] dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
            <span className="font-bold text-[#1d1a19] dark:text-[#f2eeec]">
              Pending Delivery Route Pins ({pendingStops.length})
            </span>
          </div>
          <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
            Tap any pin or stop card to inspect order & capture signature
          </span>
        </div>

        <div className="h-[360px] sm:h-[420px] w-full relative bg-[#f3ede9] dark:bg-[#1b1716]">
          {keyLoading ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-[#6b625e] dark:text-[#a59b96]">
              Loading Karachi delivery route map...
            </div>
          ) : !apiKey || mapLoadFailed ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-2">
              <MapPin className="w-7 h-7 text-[#7a2e4a] dark:text-[#d77a9c]" />
              <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                Interactive Map Unavailable
              </div>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96] max-w-sm">
                {!apiKey
                  ? "Configure your Google Maps API key to display interactive map tiles. Pending delivery stops and coordinates remain listed below."
                  : "Google Maps tiles could not be loaded in this network session. Use the pending route stop cards below to continue deliveries."}
              </p>
            </div>
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
                <MapViewportController stops={pendingStops} selectedOrderId={selectedOrderId} />
                {pendingStops.map((stop) => (
                  <PendingDeliveryMarker
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

      {/* Synchronized Pending Route Stops Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {pendingStops.map((stop) => {
          const isSelected = selectedOrderId === stop.order.id;
          return (
            <div
              key={stop.order.id}
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
                  <span className="w-6 h-6 rounded-full bg-[#7a2e4a] text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                    {stop.stopIndex}
                  </span>
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                      {stop.order.order_number} · {stop.area}
                    </div>
                    <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] truncate">
                      {stop.order.salon_name}
                    </div>
                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] truncate">
                      {stop.address}
                    </div>
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
                {stop.phone ? (
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
                  <button
                    type="button"
                    onClick={() => onSelectDeliver(stop.order.id)}
                    className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 hover:opacity-95"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Deliver & Sign</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
