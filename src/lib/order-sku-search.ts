import type { SKU } from "./data.ts";

export function filterOrderSkus(skus: readonly SKU[], rawQuery: string): SKU[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [...skus];

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return skus.filter((sku) => {
    const haystack = `${sku.name} ${sku.category} ${sku.sku_code}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
