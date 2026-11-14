import type { SKU } from "./data.ts";

export const DEFAULT_LOW_STOCK_THRESHOLD = 7;

export interface OrderStockCheckResult {
  selectedSku: SKU | null;
  availableStock: number;
  requestedQty: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  isBelowThreshold: boolean;
  exceedsStock: boolean;
  shortfall: number;
  unitLabel: string;
}

export function checkOrderIntakeStock(
  skus: readonly SKU[],
  selectedSkuId: string,
  requestedQty: number,
  lowStockThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): OrderStockCheckResult {
  const threshold = Math.max(1, Math.floor(lowStockThreshold));
  const selectedSku = skus.find((sku) => sku.id === selectedSkuId) ?? null;
  if (!selectedSku) {
    return {
      selectedSku: null,
      availableStock: 0,
      requestedQty,
      lowStockThreshold: threshold,
      isLowStock: false,
      isOutOfStock: false,
      isBelowThreshold: false,
      exceedsStock: false,
      shortfall: 0,
      unitLabel: "units",
    };
  }

  const availableStock = Math.max(0, Number(selectedSku.bag_qty ?? 0));
  const normalizedQty = Number.isFinite(requestedQty) ? Math.max(0, Math.floor(requestedQty)) : 0;
  const isOutOfStock = availableStock === 0;
  const isLowStock = availableStock > 0 && availableStock < threshold;
  const isBelowThreshold = availableStock < threshold;
  const exceedsStock = normalizedQty > availableStock;
  const shortfall = exceedsStock ? normalizedQty - availableStock : 0;
  const baseUnit = selectedSku.unit?.trim() || "unit";
  const unitLabel = availableStock === 1 ? baseUnit : `${baseUnit}s`;

  return {
    selectedSku,
    availableStock,
    requestedQty: normalizedQty,
    lowStockThreshold: threshold,
    isLowStock,
    isOutOfStock,
    isBelowThreshold,
    exceedsStock,
    shortfall,
    unitLabel,
  };
}
