import { resolveSalonCoordinates, type GeoPoint } from "./karachi-geo.ts";
import type { DeliveryOrderFull, SalonWithApproval } from "../server/types.ts";

export type DeliveryPinStatus = "pending_delivery" | "delivered";

export interface DeliveryPinStyle {
  background: string;
  borderColor: string;
  glyphColor: string;
  label: string;
}

export interface DeliveryMapStop {
  order: DeliveryOrderFull;
  salon: SalonWithApproval | null;
  position: GeoPoint;
  area: string;
  address: string;
  phone: string;
  pendingStopNumber: number | null;
}

export function getDeliveryPinStyle(
  status: DeliveryPinStatus,
  isSelected: boolean,
): DeliveryPinStyle {
  if (status === "delivered") {
    return {
      background: isSelected ? "#065f46" : "#059669",
      borderColor: "#ffffff",
      glyphColor: "#ffffff",
      label: "Delivered",
    };
  }
  return {
    background: isSelected ? "#92400e" : "#d97706",
    borderColor: "#ffffff",
    glyphColor: "#ffffff",
    label: "Pending Delivery",
  };
}

export function buildDeliveryMapStops(
  orders: readonly DeliveryOrderFull[],
  salons: readonly SalonWithApproval[],
): DeliveryMapStop[] {
  const salonLookup: Record<string, SalonWithApproval> = {};
  for (const s of salons) {
    salonLookup[s.id] = s;
  }

  const seenCoordCounts: Record<string, number> = {};
  let pendingCounter = 0;

  return orders.map((order) => {
    const salon = salonLookup[order.salon_id] ?? null;
    const basePos = resolveSalonCoordinates(salon, order.id);
    const coordKey = `${basePos.lat.toFixed(4)}:${basePos.lng.toFixed(4)}`;
    const dupIndex = seenCoordCounts[coordKey] ?? 0;
    seenCoordCounts[coordKey] = dupIndex + 1;

    // Slightly separate overlapping pins at the same salon so every order pin remains clickable
    const position: GeoPoint =
      dupIndex === 0
        ? basePos
        : {
            lat: Number((basePos.lat + dupIndex * 0.00045).toFixed(6)),
            lng: Number((basePos.lng + dupIndex * 0.00045).toFixed(6)),
          };

    const isPending = order.status === "pending_delivery";
    if (isPending) {
      pendingCounter += 1;
    }

    return {
      order,
      salon,
      position,
      area: salon?.area || "Karachi",
      address: salon?.address || `${salon?.area || "Karachi"}, Karachi`,
      phone: salon?.phone || "",
      pendingStopNumber: isPending ? pendingCounter : null,
    };
  });
}
