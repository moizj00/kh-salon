import type { SalonWithApproval } from "../server/types.ts";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const KARACHI_DEFAULT_CENTER: GeoPoint = {
  lat: 24.853,
  lng: 67.052,
};

const ZONE_COORDINATES: Array<{ keywords: string[]; point: GeoPoint }> = [
  { keywords: ["clifton", "zamzama", "boat basin"], point: { lat: 24.8138, lng: 67.0299 } },
  { keywords: ["dha", "defence", "phase 5", "phase 6", "phase 8", "badar", "bukhari"], point: { lat: 24.7937, lng: 67.0644 } },
  { keywords: ["saddar", "preedy", "rainbow", "i.i. chundrigar"], point: { lat: 24.8556, lng: 67.0261 } },
  { keywords: ["gulshan", "university road", "disco"], point: { lat: 24.9204, lng: 67.0942 } },
  { keywords: ["pechs", "tariq", "bahadurabad", "nursery", "shahrah-e-faisal"], point: { lat: 24.8716, lng: 67.0598 } },
  { keywords: ["jauhar", "johar"], point: { lat: 24.918, lng: 67.129 } },
  { keywords: ["nazimabad", "north nazimabad", "hyderi"], point: { lat: 24.938, lng: 67.039 } },
  { keywords: ["korangi", "landhi"], point: { lat: 24.835, lng: 67.133 } },
];

function stableHashOffset(seed: string): { dLat: number; dLng: number } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const normA = ((hash & 0xff) / 255) - 0.5;
  const normB = (((hash >> 8) & 0xff) / 255) - 0.5;
  return {
    dLat: Number((normA * 0.004).toFixed(5)),
    dLng: Number((normB * 0.004).toFixed(5)),
  };
}

export function resolveSalonCoordinates(
  salon: Pick<SalonWithApproval, "id" | "name" | "area" | "address" | "lat" | "lng"> | null | undefined,
  fallbackSeed = "karachi",
): GeoPoint {
  if (
    salon &&
    typeof salon.lat === "number" &&
    Number.isFinite(salon.lat) &&
    typeof salon.lng === "number" &&
    Number.isFinite(salon.lng)
  ) {
    return { lat: salon.lat, lng: salon.lng };
  }

  const haystack = `${salon?.area ?? ""} ${salon?.address ?? ""} ${salon?.name ?? ""}`.toLowerCase();
  const matched = ZONE_COORDINATES.find((z) => z.keywords.some((kw) => haystack.includes(kw)));
  const base = matched ? matched.point : KARACHI_DEFAULT_CENTER;
  const { dLat, dLng } = stableHashOffset(salon?.id || fallbackSeed);

  return {
    lat: Number((base.lat + dLat).toFixed(5)),
    lng: Number((base.lng + dLng).toFixed(5)),
  };
}
