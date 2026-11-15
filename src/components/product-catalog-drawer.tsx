import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Lock,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { createCatalogSkuApi, updateCatalogSkuApi } from "../lib/api";
import {
  canManageCatalog,
  filterCatalogSkus,
  getSkuBrand,
  type CatalogBrandFilter,
  type CatalogCategoryFilter,
  type CatalogSkuInput,
} from "../lib/catalog";
import type { SKU } from "../lib/data";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "../lib/order-stock";
import { PRODUCT_IMAGE_PRESETS } from "../lib/product-images";
import type { UserRole } from "../server/types";
import { ProductThumbnail } from "./product-thumbnail";

interface ProductCatalogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  skus: SKU[];
  selectedSkuId?: string;
  onSelectSkuForOrder?: (sku: SKU) => void;
  userRole: UserRole;
  onCatalogUpdated: (savedSku: SKU) => Promise<void> | void;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
  initialEditSku?: SKU | null;
  startInCreateMode?: boolean;
}

const BRAND_FILTERS: Array<{ id: CatalogBrandFilter; label: string }> = [
  { id: "all", label: "All Brands" },
  { id: "Lumex", label: "Lumex" },
  { id: "Mocheqi Musk", label: "Mocheqi Musk" },
  { id: "other", label: "Kiran / Lunex / Kemon" },
];

const CATEGORY_FILTERS: Array<{ id: CatalogCategoryFilter; label: string }> = [
  { id: "all", label: "All Types" },
  { id: "Shampoo", label: "Shampoo" },
  { id: "Treatment", label: "Treatment" },
  { id: "Styling", label: "Styling" },
  { id: "Color", label: "Color" },
];

function buildInitialForm(sku?: SKU | null): CatalogSkuInput {
  if (sku) {
    return {
      sku_code: sku.sku_code,
      name: sku.name,
      category: sku.category,
      price: sku.price,
      bag_qty: sku.bag_qty,
      unit: sku.unit,
      brand: getSkuBrand(sku),
      product_type: sku.product_type ?? `${sku.category} Formula`,
      volume_size: sku.volume_size ?? "500ml",
      recommended_use:
        sku.recommended_use ??
        "Professional salon backwash or chairside treatment application.",
      image_key: sku.image_key ?? "lumex-clarifying",
    };
  }
  return {
    sku_code: "",
    name: "",
    category: "Treatment",
    price: 3500,
    bag_qty: 8,
    unit: "Bottle",
    brand: "Lumex",
    product_type: "",
    volume_size: "500ml",
    recommended_use: "",
    image_key: "lumex-keratin",
  };
}

export const ProductCatalogDrawer: React.FC<ProductCatalogDrawerProps> = ({
  isOpen,
  onClose,
  skus,
  selectedSkuId,
  onSelectSkuForOrder,
  userRole,
  onCatalogUpdated,
  showToast,
  initialEditSku = null,
  startInCreateMode = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState<CatalogBrandFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CatalogCategoryFilter>("all");
  const [editorMode, setEditorMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingSku, setEditingSku] = useState<SKU | null>(null);
  const [formState, setFormState] = useState<CatalogSkuInput>(() => buildInitialForm(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allowEdit = canManageCatalog(userRole);

  useEffect(() => {
    if (!isOpen) {
      setEditorMode("closed");
      setEditingSku(null);
      setFormError(null);
      return;
    }
    if (allowEdit && initialEditSku) {
      setEditingSku(initialEditSku);
      setFormState(buildInitialForm(initialEditSku));
      setEditorMode("edit");
    } else if (allowEdit && startInCreateMode) {
      setEditingSku(null);
      setFormState(buildInitialForm(null));
      setEditorMode("create");
    }
  }, [isOpen, allowEdit, initialEditSku, startInCreateMode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editorMode !== "closed") {
          setEditorMode("closed");
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, editorMode, onClose]);

  const filteredSkus = useMemo(
    () =>
      filterCatalogSkus(skus, {
        query: searchQuery,
        brand: brandFilter,
        category: categoryFilter,
      }),
    [skus, searchQuery, brandFilter, categoryFilter],
  );

  if (!isOpen) return null;

  const openCreateEditor = () => {
    if (!allowEdit) return;
    setEditingSku(null);
    setFormState(buildInitialForm(null));
    setFormError(null);
    setEditorMode("create");
  };

  const openEditEditor = (sku: SKU) => {
    if (!allowEdit) return;
    setEditingSku(sku);
    setFormState(buildInitialForm(sku));
    setFormError(null);
    setEditorMode("edit");
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowEdit) return;
    setFormError(null);
    setSaving(true);
    try {
      const response =
        editorMode === "edit" && editingSku
          ? await updateCatalogSkuApi(editingSku.id, formState)
          : await createCatalogSkuApi(formState);
      showToast(response.message, "ok");
      await onCatalogUpdated(response.sku);
      setEditorMode("closed");
      setEditingSku(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save product.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-catalog-drawer-title"
      data-testid="product-catalog-drawer"
      className="fixed inset-0 z-[60] flex justify-end bg-black/60 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl h-full bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] shadow-2xl border-l border-[#e6dfdb] dark:border-[#3a3330] flex flex-col">
        {/* Drawer Header */}
        <div className="px-5 py-4 bg-white dark:bg-[#211d1b] border-b border-[#e6dfdb] dark:border-[#3a3330] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
              <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Lumex &amp; Mocheqi Musk Product Catalog</span>
            </div>
            <h2
              id="product-catalog-drawer-title"
              className="font-bold text-base sm:text-lg tracking-tight mt-0.5"
            >
              Salon Haircare Reference &amp; Stock
            </h2>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96] mt-0.5">
              Search product types, volume sizing, and recommended chairside salon usage.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {allowEdit && editorMode === "closed" && (
              <button
                type="button"
                data-testid="catalog-add-product-btn"
                onClick={openCreateEditor}
                className="px-3 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs hover:opacity-95 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add Product</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Close product catalog"
              data-testid="catalog-close-btn"
              onClick={onClose}
              className="p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] hover:text-[#1d1a19] dark:text-[#a59b96] dark:hover:text-[#f2eeec]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Role Governance Bar */}
        <div className="px-5 py-2 bg-white/80 dark:bg-[#211d1b]/80 border-b border-[#e6dfdb]/70 dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6b625e] dark:text-[#a59b96] shrink-0">
          {allowEdit ? (
            <span className="text-[#7a2e4a] dark:text-[#d77a9c] font-medium">
              Owner &amp; Manager Access: You can add new SKUs and edit Lumex / Mocheqi Musk catalog entries.
            </span>
          ) : (
            <span className="flex items-center gap-1.5" data-testid="catalog-readonly-notice">
              <Lock className="w-3.5 h-3.5 shrink-0 text-[#6b625e] dark:text-[#a59b96]" aria-hidden="true" />
              <span>Catalog additions and brand changes are restricted to Owner &amp; Office Manager.</span>
            </span>
          )}
          <span className="tabular-nums font-medium" data-testid="catalog-match-count">
            {filteredSkus.length} of {skus.length} products
          </span>
        </div>

        {/* Owner / Manager Add-or-Edit Product Sub-Panel */}
        {allowEdit && editorMode !== "closed" ? (
          <form
            onSubmit={handleSaveProduct}
            data-testid="catalog-editor-form"
            className="flex-1 overflow-y-auto p-5 space-y-4 bg-white dark:bg-[#211d1b]"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e6dfdb] dark:border-[#3a3330]">
              <div>
                <h3 className="font-bold text-sm">
                  {editorMode === "edit" && editingSku
                    ? `Edit Catalog Product: ${editingSku.sku_code}`
                    : "Add Product to Catalog & Order Intake Stock"}
                </h3>
                <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                  Changes sync immediately across the rep catalog drawer and Order Intake stock.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditorMode("closed")}
                className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Back to Catalog
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs"
              >
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label htmlFor="cat-brand" className="block font-semibold mb-1">
                  Brand Line
                </label>
                <input
                  id="cat-brand"
                  type="text"
                  required
                  placeholder="e.g. Lumex or Mocheqi Musk"
                  value={formState.brand}
                  onChange={(e) => setFormState((prev) => ({ ...prev, brand: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>

              <div>
                <label htmlFor="cat-sku-code" className="block font-semibold mb-1">
                  SKU Code
                </label>
                <input
                  id="cat-sku-code"
                  type="text"
                  required
                  placeholder="e.g. LMX-MASK-500"
                  value={formState.sku_code}
                  onChange={(e) => setFormState((prev) => ({ ...prev, sku_code: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="cat-name" className="block font-semibold mb-1">
                  Product Name
                </label>
                <input
                  id="cat-name"
                  type="text"
                  required
                  placeholder="e.g. Lumex Deep Keratin Repair Mask 500ml"
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>

              <div>
                <label htmlFor="cat-product-type" className="block font-semibold mb-1">
                  Product Type
                </label>
                <input
                  id="cat-product-type"
                  type="text"
                  required
                  placeholder="e.g. Anti-Grease Shampoo"
                  value={formState.product_type}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, product_type: e.target.value }))
                  }
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>

              <div>
                <label htmlFor="cat-volume" className="block font-semibold mb-1">
                  Volume Sizing
                </label>
                <input
                  id="cat-volume"
                  type="text"
                  required
                  placeholder="e.g. 318ml, 500ml, 1000ml"
                  value={formState.volume_size}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, volume_size: e.target.value }))
                  }
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>

              <div>
                <label htmlFor="cat-category" className="block font-semibold mb-1">
                  Category
                </label>
                <select
                  id="cat-category"
                  value={formState.category}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      category: e.target.value as SKU["category"],
                    }))
                  }
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                >
                  <option value="Shampoo">Shampoo</option>
                  <option value="Treatment">Treatment</option>
                  <option value="Styling">Styling</option>
                  <option value="Color">Color</option>
                </select>
              </div>

              <div>
                <label htmlFor="cat-unit" className="block font-semibold mb-1">
                  Packaging Unit
                </label>
                <input
                  id="cat-unit"
                  type="text"
                  required
                  placeholder="Bottle, Tub, Jar, Pump, Tube"
                  value={formState.unit}
                  onChange={(e) => setFormState((prev) => ({ ...prev, unit: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>

              <div>
                <label htmlFor="cat-price" className="block font-semibold mb-1">
                  Unit Price (PKR)
                </label>
                <input
                  id="cat-price"
                  type="number"
                  min={1}
                  required
                  value={formState.price}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, price: Number(e.target.value) || 0 }))
                  }
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="cat-stock" className="block font-semibold mb-1">
                  Warehouse Stock Qty
                </label>
                <input
                  id="cat-stock"
                  type="number"
                  min={0}
                  required
                  value={formState.bag_qty}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      bag_qty: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="cat-image-key" className="block font-semibold mb-1">
                  Product Thumbnail Artwork
                </label>
                <div className="flex items-center gap-3">
                  <ProductThumbnail
                    sku={{
                      name: formState.name || "Preview",
                      brand: formState.brand,
                      category: formState.category,
                      product_type: formState.product_type,
                      image_key: formState.image_key,
                    }}
                    className="w-12 h-12 rounded-xl"
                  />
                  <select
                    id="cat-image-key"
                    value={formState.image_key ?? "lumex-clarifying"}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, image_key: e.target.value }))
                    }
                    className="flex-1 p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  >
                    {PRODUCT_IMAGE_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="cat-use" className="block font-semibold mb-1">
                  Recommended Salon Use
                </label>
                <textarea
                  id="cat-use"
                  rows={3}
                  required
                  placeholder="Step-by-step chairside or backwash salon application instructions..."
                  value={formState.recommended_use}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, recommended_use: e.target.value }))
                  }
                  className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#e6dfdb] dark:border-[#3a3330] flex gap-2">
              <button
                type="button"
                onClick={() => setEditorMode("closed")}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                data-testid="catalog-save-product-btn"
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : editorMode === "edit"
                    ? "Save Catalog Changes"
                    : "Add to Catalog & Stock"}
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Search & Filter Toolbar */}
            <div className="px-5 py-3 bg-white dark:bg-[#211d1b] border-b border-[#e6dfdb] dark:border-[#3a3330] space-y-2.5 shrink-0">
              <div className="relative">
                <Search
                  className="w-4 h-4 text-[#6b625e] dark:text-[#a59b96] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="catalog-search-input"
                  data-testid="catalog-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Lumex, Mocheqi Musk, product type, volume (e.g. 500ml), or salon use..."
                  className="w-full pl-9 pr-9 py-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] focus:outline-none focus:ring-2 focus:ring-[#7a2e4a]/25"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear catalog search"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-[#6b625e] hover:text-[#1d1a19] dark:text-[#a59b96] dark:hover:text-[#f2eeec]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {BRAND_FILTERS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    data-testid={`catalog-brand-${b.id}`}
                    onClick={() => setBrandFilter(b.id)}
                    className={`px-3 py-1.5 rounded-xl font-medium whitespace-nowrap shrink-0 transition-colors ${
                      brandFilter === b.id
                        ? "bg-[#7a2e4a] text-white"
                        : "bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96] hover:border-[#7a2e4a]"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {CATEGORY_FILTERS.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                      categoryFilter === cat.id
                        ? "bg-[#1d1a19] dark:bg-[#f2eeec] text-white dark:text-[#171413]"
                        : "bg-transparent border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96] hover:border-[#7a2e4a]"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Catalog Card Grid */}
            <div className="flex-1 overflow-y-auto p-5">
              {filteredSkus.length === 0 ? (
                <div className="py-12 text-center space-y-2.5 bg-white dark:bg-[#211d1b] rounded-2xl border border-[#e6dfdb] dark:border-[#3a3330] p-6">
                  <Sparkles className="w-6 h-6 mx-auto text-[#7a2e4a] dark:text-[#d77a9c]" />
                  <div className="font-semibold text-sm">No matching catalog products</div>
                  <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                    Try clearing your search or switching brand and category filters.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setBrandFilter("all");
                      setCategoryFilter("all");
                    }}
                    className="px-4 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
                  >
                    Reset Catalog Filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {filteredSkus.map((sku) => {
                    const brand = getSkuBrand(sku);
                    const productType = sku.product_type ?? `${sku.category} Formula`;
                    const volume = sku.volume_size ?? sku.unit;
                    const recommendedUse =
                      sku.recommended_use ??
                      "Professional salon application tailored to hair condition and treatment step.";
                    const qty = Math.max(0, Number(sku.bag_qty ?? 0));
                    const isOutOfStock = qty === 0;
                    const isLowStock = qty > 0 && qty < DEFAULT_LOW_STOCK_THRESHOLD;
                    const isSelected = selectedSkuId === sku.id;

                    return (
                      <article
                        key={sku.id}
                        data-testid={`catalog-card-${sku.id}`}
                        className={`p-4 rounded-2xl bg-white dark:bg-[#211d1b] border transition-colors flex flex-col justify-between gap-3 ${
                          isSelected
                            ? "border-[#7a2e4a] ring-1 ring-[#7a2e4a]/25"
                            : "border-[#e6dfdb] dark:border-[#3a3330] hover:border-[#7a2e4a]/60"
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex gap-3 items-start">
                            <ProductThumbnail sku={sku} className="w-20 h-20 rounded-xl" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#7a2e4a] dark:text-[#d77a9c] truncate">
                                {brand} · {volume}
                              </div>
                              <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] leading-snug">
                                {sku.name}
                              </h3>
                              <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] font-mono">
                                {sku.sku_code}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-[1.35fr_1fr] gap-2 text-[11px] p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/70 dark:border-[#3a3330]">
                            <div>
                              <div className="text-[#6b625e] dark:text-[#a59b96]">Product Type</div>
                              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] leading-snug">
                                {productType}
                              </div>
                            </div>
                            <div>
                              <div className="text-[#6b625e] dark:text-[#a59b96]">Volume &amp; Pack</div>
                              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] tabular-nums leading-snug">
                                {volume} · {sku.unit}
                              </div>
                            </div>
                          </div>

                          <div className="text-xs leading-relaxed text-[#6b625e] dark:text-[#a59b96]">
                            <span className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">
                              Recommended Salon Use:{" "}
                            </span>
                            {recommendedUse}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-[#e6dfdb]/70 dark:border-[#3a3330] flex items-center justify-between gap-2">
                          <div>
                            <div className="font-extrabold text-sm text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                              PKR {sku.price.toLocaleString()}
                            </div>
                            <div
                              className={`text-[11px] tabular-nums flex items-center gap-1 ${
                                isOutOfStock
                                  ? "text-rose-700 dark:text-rose-300 font-semibold"
                                  : isLowStock
                                    ? "text-amber-700 dark:text-amber-300 font-semibold"
                                    : "text-[#6b625e] dark:text-[#a59b96]"
                              }`}
                            >
                              {(isOutOfStock || isLowStock) && (
                                <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                              )}
                              <span>
                                {isOutOfStock
                                  ? "Out of bag stock"
                                  : isLowStock
                                    ? `Low stock · ${qty} ${sku.unit}s`
                                    : `${qty} ${sku.unit}s in bag`}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {allowEdit && (
                              <button
                                type="button"
                                data-testid={`catalog-edit-${sku.id}`}
                                onClick={() => openEditEditor(sku)}
                                className="px-2.5 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a] flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                            )}

                            {onSelectSkuForOrder && (
                              <button
                                type="button"
                                data-testid={`catalog-select-${sku.id}`}
                                onClick={() => onSelectSkuForOrder(sku)}
                                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                                  isSelected
                                    ? "bg-emerald-700 text-white"
                                    : "bg-[#7a2e4a] text-white hover:opacity-95"
                                }`}
                              >
                                {isSelected && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                                <span>{isSelected ? "Selected" : "Select for Order"}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
