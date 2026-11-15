import type { SKU } from "./data.ts";

export type CatalogBrandFilter = "all" | "Lumex" | "Mocheqi Musk" | "other";
export type CatalogCategoryFilter = "all" | SKU["category"];

export interface CatalogSkuInput {
  sku_code: string;
  name: string;
  category: SKU["category"];
  price: number;
  bag_qty: number;
  unit: string;
  brand: string;
  product_type: string;
  volume_size: string;
  recommended_use: string;
  image_key?: string;
}

const VALID_CATEGORIES = new Set<SKU["category"]>(["Treatment", "Styling", "Color", "Shampoo"]);

export function canManageCatalog(role?: string | null): boolean {
  return role === "manager" || role === "owner";
}

export function getSkuBrand(sku: Pick<SKU, "brand" | "name">): string {
  if (sku.brand && sku.brand.trim()) return sku.brand.trim();
  const lower = sku.name.toLowerCase();
  if (lower.includes("mocheqi") || lower.includes("musk")) return "Mocheqi Musk";
  if (lower.includes("lumex")) return "Lumex";
  if (lower.includes("lunex")) return "Lunex";
  if (lower.includes("kemon")) return "Kemon";
  return "Kiran Professional";
}

export function filterCatalogSkus(
  skus: readonly SKU[],
  filters: {
    query?: string;
    brand?: CatalogBrandFilter;
    category?: CatalogCategoryFilter;
  },
): SKU[] {
  const query = (filters.query ?? "").trim().toLowerCase();
  const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
  const brandFilter = filters.brand ?? "all";
  const categoryFilter = filters.category ?? "all";

  return skus.filter((sku) => {
    const resolvedBrand = getSkuBrand(sku);
    if (brandFilter === "Lumex" && resolvedBrand.toLowerCase() !== "lumex") {
      return false;
    }
    if (brandFilter === "Mocheqi Musk" && resolvedBrand.toLowerCase() !== "mocheqi musk") {
      return false;
    }
    if (
      brandFilter === "other" &&
      (resolvedBrand.toLowerCase() === "lumex" || resolvedBrand.toLowerCase() === "mocheqi musk")
    ) {
      return false;
    }

    if (categoryFilter !== "all" && sku.category !== categoryFilter) {
      return false;
    }

    if (tokens.length === 0) return true;

    const haystack = [
      sku.name,
      resolvedBrand,
      sku.sku_code,
      sku.category,
      sku.product_type ?? "",
      sku.volume_size ?? "",
      sku.recommended_use ?? "",
      sku.unit,
    ]
      .join(" ")
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

export function validateCatalogSkuInput(raw: Partial<CatalogSkuInput>): {
  ok: true;
  value: CatalogSkuInput;
} | {
  ok: false;
  error: string;
} {
  const name = String(raw.name ?? "").trim();
  const sku_code = String(raw.sku_code ?? "").trim().toUpperCase();
  const brand = String(raw.brand ?? "").trim();
  const product_type = String(raw.product_type ?? "").trim();
  const volume_size = String(raw.volume_size ?? "").trim();
  const recommended_use = String(raw.recommended_use ?? "").trim();
  const unit = String(raw.unit ?? "Bottle").trim() || "Bottle";
  const category = raw.category;
  const price = Number(raw.price);
  const bag_qty = Number(raw.bag_qty ?? 0);
  const image_key = raw.image_key ? String(raw.image_key).trim() : undefined;

  if (!name) return { ok: false, error: "Product name is required." };
  if (!sku_code) return { ok: false, error: "SKU code is required." };
  if (!brand) return { ok: false, error: "Brand name is required." };
  if (!category || !VALID_CATEGORIES.has(category)) {
    return { ok: false, error: "Please choose a valid category (Shampoo, Treatment, Styling, or Color)." };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Unit price in PKR must be greater than 0." };
  }
  if (!Number.isFinite(bag_qty) || bag_qty < 0) {
    return { ok: false, error: "Bag stock quantity cannot be negative." };
  }
  if (!product_type) {
    return { ok: false, error: "Product type is required (e.g. Keratin Treatment, Nourishing Shampoo)." };
  }
  if (!volume_size) {
    return { ok: false, error: "Volume sizing is required (e.g. 318ml, 500ml, 1000ml)." };
  }
  if (!recommended_use) {
    return { ok: false, error: "Recommended salon use details are required." };
  }

  return {
    ok: true,
    value: {
      name,
      sku_code,
      brand,
      category,
      price: Math.round(price),
      bag_qty: Math.round(bag_qty),
      unit,
      product_type,
      volume_size,
      recommended_use,
      image_key,
    },
  };
}
