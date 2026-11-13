import React, { useState } from "react";
import { Check, ExternalLink, PackageCheck, ShieldCheck, ShoppingBag, Store, X } from "lucide-react";
import { submitShopOrder } from "../lib/api";
import type { PublicShopOrder } from "../server/types";
import muskColorImg from "../assets/images/musk_hair_color_cream_1794525597659.jpg";
import lunexBleachImg from "../assets/images/lunex_bleach_powder_tub_1794525597118.jpg";
import kemonShampooImg from "../assets/images/kemon_color_shampoo_bottle_1794525597500.jpg";
import kiranKeratinImg from "../assets/images/kiran_keratin_complex_bottle_1794525598009.jpg";

export type StorefrontProduct = {
  id: string;
  slug: string;
  name: string;
  brand_label: "Musk" | "Lunex" | "Kemon" | "Kiran Professional";
  category_name: string;
  category_slug: string;
  meta_title: string;
  meta_description: string;
  body: string;
  how_to_use: string;
  image_url: string;
  min_price_pkr: number;
  shades: Array<{ id: string; code: string; variant: string; list_price_pkr: number }>;
};

export const INITIAL_STOREFRONT_PRODUCTS: StorefrontProduct[] = [
  {
    id: "sp-musk-color",
    slug: "musk-professional-hair-color-60ml",
    name: "Musk Professional Hair Color Cream 60ml",
    brand_label: "Musk",
    category_name: "Hair Color",
    category_slug: "hair-color",
    meta_title: "Musk Professional Hair Color Cream 60ml | khsalon.com",
    meta_description: "Rich Italian formulation hair color tube with intense pigment coverage and hair conditioning oils.",
    body: "Musk Professional Color Cream offers 100% white hair coverage with low ammonia technology. Enriched with argan oil and silk proteins for long-lasting vibrancy and luminous shine.",
    how_to_use: "Mix 1:1.5 with Musk Developer (20Vol or 30Vol). Apply evenly to unwashed dry hair. Process for 35 minutes before rinsing thoroughly.",
    image_url: muskColorImg,
    min_price_pkr: 850,
    shades: [
      { id: "sk-musk-61", code: "MUSK-6.1", variant: "Ash Brown 6.1", list_price_pkr: 850 },
      { id: "sk-musk-30", code: "MUSK-3.0", variant: "Dark Natural Brown 3.0", list_price_pkr: 850 },
      { id: "sk-musk-83", code: "MUSK-8.3", variant: "Golden Blonde 8.3", list_price_pkr: 850 },
      { id: "sk-musk-10", code: "MUSK-1.0", variant: "Deep Black 1.0", list_price_pkr: 850 },
    ],
  },
  {
    id: "sp-lunex-bleach",
    slug: "lunex-ultra-decolor-lightening-powder-500g",
    name: "Lunex Ultra Decolor Lightening Powder 500g",
    brand_label: "Lunex",
    category_name: "Lighteners & Bleach",
    category_slug: "lighteners",
    meta_title: "Lunex Ultra Decolor Lightening Powder 500g | khsalon.com",
    meta_description: "Dust-free blue lightening powder capable of up to 7 levels of lift while preserving hair fiber integrity.",
    body: "Lunex Ultra Decolor delivers rapid, uniform lift without warm brassy undertones. Formulated for sensitive scalps and full-head or foil techniques.",
    how_to_use: "Mix 1:2 in a non-metallic bowl with developer (10Vol, 20Vol, or 30Vol). Process up to 45 minutes visually.",
    image_url: lunexBleachImg,
    min_price_pkr: 4200,
    shades: [
      { id: "sk-lunex-500", code: "LUNEX-500G", variant: "Dust-Free Tub 500g", list_price_pkr: 4200 },
    ],
  },
  {
    id: "sp-kemon-actyva",
    slug: "kemon-actyva-color-care-shampoo-250ml",
    name: "Kemon Actyva Color Care Protective Shampoo 250ml",
    brand_label: "Kemon",
    category_name: "Hair Care & Shampoo",
    category_slug: "hair-care",
    meta_title: "Kemon Actyva Color Care Shampoo 250ml | khsalon.com",
    meta_description: "Sulfate-free eco-certified Italian shampoo formulated to lock in color pigments and shield against UV degradation.",
    body: "Actyva Color Care gentle cleanser cleanses delicate color-treated hair while reinforcing cuticle seals. Leaves hair silky, buoyant and vibrant.",
    how_to_use: "Apply evenly to damp hair, massage into a creamy lather, leave for 2 minutes, then rinse gently with lukewarm water.",
    image_url: kemonShampooImg,
    min_price_pkr: 3200,
    shades: [
      { id: "sk-kemon-250", code: "KEM-CC-250", variant: "Retail Bottle 250ml", list_price_pkr: 3200 },
      { id: "sk-kemon-1000", code: "KEM-CC-1L", variant: "Salon Size 1L", list_price_pkr: 8900 },
    ],
  },
  {
    id: "sp-kiran-keratin",
    slug: "kiran-brazilian-keratin-complex-500ml",
    name: "Kiran Brazilian Keratin Smoothing Complex 500ml",
    brand_label: "Kiran Professional",
    category_name: "Treatments",
    category_slug: "treatments",
    meta_title: "Kiran Brazilian Keratin Complex 500ml | khsalon.com",
    meta_description: "Intense smoothing and frizz-elimination formula with real hydrolyzed keratin proteins and argan oil.",
    body: "Eliminates 95% of frizz and curls for up to 4 months. Restores damaged cuticle structures and bestows intense diamond shine.",
    how_to_use: "Wash twice with clarifying shampoo. Blow dry 80%. Apply treatment section by section, blow dry smooth, and flat iron at 230°C.",
    image_url: kiranKeratinImg,
    min_price_pkr: 6800,
    shades: [
      { id: "sk-krt-500", code: "KRN-KRT-500", variant: "Professional Bottle 500ml", list_price_pkr: 6800 },
    ],
  },
];

const ProductImage: React.FC<{ src: string; alt: string; brand: string }> = ({ src, alt, brand }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#7a2e4a]/15 via-[#faf7f5] to-[#e6dfdb]/60 dark:from-[#7a2e4a]/30 dark:to-[#171413] p-2 text-center">
        <ShoppingBag className="w-6 h-6 text-[#7a2e4a] dark:text-[#d77a9c] mb-1" />
        <span className="text-[10px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c] leading-tight">
          {brand}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover object-center"
    />
  );
};

export const StorefrontView: React.FC<{
  onOpenSalonOrderModal: (productName: string) => void;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
  onOrderCreated?: (order: PublicShopOrder) => void;
}> = ({ onOpenSalonOrderModal, showToast, onOrderCreated }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeProduct, setActiveProduct] = useState<StorefrontProduct | null>(null);
  const [selectedShadeId, setSelectedShadeId] = useState<string | null>(null);

  // Direct Checkout modal state
  const [checkoutProduct, setCheckoutProduct] = useState<StorefrontProduct | null>(null);
  const [checkoutShadeId, setCheckoutShadeId] = useState<string>("");
  const [checkoutQty, setCheckoutQty] = useState<number>(1);
  const [customerName, setCustomerName] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [deliveryAddress, setDeliveryAddress] = useState<string>("");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [confirmedOrder, setConfirmedOrder] = useState<PublicShopOrder | null>(null);

  const categories = [
    { id: "all", label: "All Products" },
    { id: "hair-color", label: "Musk Hair Color" },
    { id: "lighteners", label: "Lunex Bleach" },
    { id: "hair-care", label: "Kemon Actyva" },
    { id: "treatments", label: "Kiran Professional" },
  ];

  const filtered =
    selectedCategory === "all"
      ? INITIAL_STOREFRONT_PRODUCTS
      : INITIAL_STOREFRONT_PRODUCTS.filter((p) => p.category_slug === selectedCategory);

  const openCheckout = (product: StorefrontProduct, shadeId?: string | null) => {
    setCheckoutProduct(product);
    setCheckoutShadeId(shadeId || product.shades[0]?.id || "");
    setCheckoutQty(1);
    setCheckoutError(null);
    setConfirmedOrder(null);
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutProduct) return;
    const shade =
      checkoutProduct.shades.find((s) => s.id === checkoutShadeId) || checkoutProduct.shades[0];
    if (!shade) return;

    if (!customerName.trim() || !customerPhone.trim() || !deliveryAddress.trim()) {
      setCheckoutError("Please enter your full name, mobile number, and delivery address.");
      return;
    }

    setCheckoutError(null);
    setSubmitting(true);
    try {
      const created = await submitShopOrder({
        productId: checkoutProduct.id,
        productName: checkoutProduct.name,
        shadeCode: shade.code,
        shadeVariant: shade.variant,
        qty: checkoutQty,
        unitPricePkr: shade.list_price_pkr,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        deliveryAddress: deliveryAddress.trim(),
      });
      setConfirmedOrder(created);
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      onOrderCreated?.(created);
      showToast(`Order ${created.orderNumber} saved (PKR ${created.totalPkr.toLocaleString()}).`, "ok");
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Could not place order.");
    } finally {
      setSubmitting(false);
    }
  };

  const activeCheckoutShade = checkoutProduct
    ? checkoutProduct.shades.find((s) => s.id === checkoutShadeId) || checkoutProduct.shades[0]
    : null;

  return (
    <div className="space-y-4">
      {/* Brand Storefront Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-[#7a2e4a] to-[#4a182c] text-white shadow-sm space-y-2.5">
        <div className="flex items-center justify-between text-xs text-white/85">
          <span className="font-semibold tracking-wide">Official Public Storefront</span>
          <span className="text-amber-200 font-mono">khsalon.com</span>
        </div>

        <div>
          <h2 className="font-extrabold text-xl tracking-tight">KH Enterprises Store</h2>
          <p className="text-xs text-white/80 mt-0.5">
            Official Pakistan distributor of Musk, Lunex, Kemon & Kiran Professional.
          </p>
        </div>

        <div className="pt-2.5 border-t border-white/15 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-100">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>Direct Retail Checkout (PKR)</span>
          </div>
          <div className="flex items-center gap-1.5 font-medium">
            <Store className="w-4 h-4 shrink-0" />
            <span>Physical Hub: KH Salon, Karachi</span>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedCategory(c.id)}
            className={`px-3.5 py-2 rounded-xl font-medium whitespace-nowrap shrink-0 transition-colors min-h-[40px] ${
              selectedCategory === c.id
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96] hover:border-[#7a2e4a]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filtered.map((product) => (
          <div
            key={product.id}
            className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex flex-col justify-between gap-3 hover:border-[#7a2e4a] transition-colors"
          >
            <div className="flex gap-3.5">
              <div className="w-24 h-24 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] overflow-hidden shrink-0">
                <ProductImage
                  src={product.image_url}
                  alt={product.name}
                  brand={product.brand_label}
                />
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-[11px] font-medium text-[#6b625e] dark:text-[#a59b96] flex items-center gap-1.5">
                  <span className="text-[#7a2e4a] dark:text-[#d77a9c] font-semibold">
                    {product.brand_label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{product.category_name}</span>
                </div>

                <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] leading-snug">
                  {product.name}
                </h3>

                <p className="text-xs text-[#6b625e] dark:text-[#a59b96] line-clamp-2">
                  {product.meta_description}
                </p>

                <div className="pt-1 flex items-baseline justify-between gap-2">
                  <div className="font-extrabold text-sm text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                    PKR {product.min_price_pkr.toLocaleString()}
                  </div>
                  <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                    {product.shades.length} option{product.shades.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2.5 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setActiveProduct(product);
                  setSelectedShadeId(product.shades[0]?.id || null);
                }}
                className="px-3 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] font-medium hover:border-[#7a2e4a] text-[#1d1a19] dark:text-[#f2eeec] whitespace-nowrap"
              >
                View Details
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenSalonOrderModal(product.name)}
                  className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300/50 font-semibold whitespace-nowrap hover:bg-amber-100"
                >
                  Salon Pricing
                </button>

                <button
                  type="button"
                  onClick={() => openCheckout(product, product.shades[0]?.id)}
                  className="px-3.5 py-2 rounded-xl bg-[#7a2e4a] text-white font-semibold flex items-center gap-1.5 shadow-xs hover:opacity-95 whitespace-nowrap"
                >
                  <span>Buy Direct</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Product Detail Modal */}
      {activeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                  {activeProduct.brand_label} · {activeProduct.category_name}
                </div>
                <h3 className="font-extrabold text-base text-[#1d1a19] dark:text-[#f2eeec] mt-0.5">
                  {activeProduct.name}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close product details"
                onClick={() => setActiveProduct(null)}
                className="p-2 text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full h-44 rounded-xl overflow-hidden bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330]">
              <ProductImage
                src={activeProduct.image_url}
                alt={activeProduct.name}
                brand={activeProduct.brand_label}
              />
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">Product Details</div>
              <p className="text-[#6b625e] dark:text-[#a59b96] leading-relaxed">{activeProduct.body}</p>

              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] pt-2">How to Use</div>
              <p className="text-[#6b625e] dark:text-[#a59b96] leading-relaxed bg-[#faf7f5] dark:bg-[#171413] p-3 rounded-xl border border-[#e6dfdb]/60 dark:border-[#3a3330]">
                {activeProduct.how_to_use}
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">Select Option / Shade</div>
              <div className="grid grid-cols-2 gap-2">
                {activeProduct.shades.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedShadeId(s.id)}
                    className={`p-2.5 rounded-xl text-left border transition-colors ${
                      selectedShadeId === s.id
                        ? "border-[#7a2e4a] bg-[#7a2e4a]/5 font-bold"
                        : "border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
                    }`}
                  >
                    <div className="text-xs truncate text-[#1d1a19] dark:text-[#f2eeec]">{s.variant}</div>
                    <div className="text-xs text-[#7a2e4a] dark:text-[#d77a9c] font-extrabold tabular-nums mt-0.5">
                      PKR {s.list_price_pkr.toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-[#e6dfdb] dark:border-[#3a3330] flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const name = activeProduct.name;
                  setActiveProduct(null);
                  onOpenSalonOrderModal(name);
                }}
                className="flex-1 py-2.5 rounded-xl border border-[#7a2e4a] text-[#7a2e4a] dark:text-[#d77a9c] font-bold text-xs"
              >
                Salon Portal Order
              </button>

              <button
                type="button"
                onClick={() => {
                  const p = activeProduct;
                  const shade = selectedShadeId;
                  setActiveProduct(null);
                  openCheckout(p, shade);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs"
              >
                <span>Buy Direct</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Direct Checkout Modal */}
      {checkoutProduct && activeCheckoutShade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                  khsalon.com · Direct Checkout
                </div>
                <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                  {confirmedOrder ? "Order Confirmed" : checkoutProduct.name}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close checkout"
                onClick={() => {
                  setCheckoutProduct(null);
                  setConfirmedOrder(null);
                }}
                className="p-2 text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {confirmedOrder ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 text-sm">
                    <PackageCheck className="w-5 h-5" />
                    <span>Saved to KH Enterprises Dispatch</span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-[#6b625e] dark:text-[#a59b96]">Order Reference</span>
                    <span className="font-mono font-bold text-[#1d1a19] dark:text-[#f2eeec]">
                      {confirmedOrder.orderNumber}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b625e] dark:text-[#a59b96]">Item</span>
                    <span className="font-medium text-right">
                      {confirmedOrder.qty}x {confirmedOrder.shadeVariant}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b625e] dark:text-[#a59b96]">Total COD</span>
                    <span className="font-bold tabular-nums text-[#7a2e4a] dark:text-[#d77a9c]">
                      PKR {confirmedOrder.totalPkr.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b625e] dark:text-[#a59b96]">Status</span>
                    <span className="font-semibold capitalize">{confirmedOrder.status}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setCheckoutProduct(null);
                    setConfirmedOrder(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#7a2e4a] text-white font-semibold text-xs flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Done</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handlePlaceOrder} className="space-y-3 text-xs">
                {checkoutError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300">
                    {checkoutError}
                  </div>
                )}

                <div>
                  <label htmlFor="shop-shade" className="block font-semibold mb-1">
                    Option / Shade
                  </label>
                  <select
                    id="shop-shade"
                    value={activeCheckoutShade.id}
                    onChange={(e) => setCheckoutShadeId(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  >
                    {checkoutProduct.shades.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.variant} — PKR {s.list_price_pkr.toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="shop-qty" className="block font-semibold mb-1">
                    Quantity
                  </label>
                  <input
                    id="shop-qty"
                    type="number"
                    min={1}
                    max={50}
                    value={checkoutQty}
                    onChange={(e) => setCheckoutQty(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums"
                  />
                </div>

                <div>
                  <label htmlFor="shop-name" className="block font-semibold mb-1">
                    Full Name
                  </label>
                  <input
                    id="shop-name"
                    type="text"
                    required
                    placeholder="e.g. Ayesha Siddiqui"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>

                <div>
                  <label htmlFor="shop-phone" className="block font-semibold mb-1">
                    Mobile Phone
                  </label>
                  <input
                    id="shop-phone"
                    type="tel"
                    required
                    placeholder="0300-1234567"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>

                <div>
                  <label htmlFor="shop-address" className="block font-semibold mb-1">
                    Delivery Address (Karachi / Pakistan)
                  </label>
                  <textarea
                    id="shop-address"
                    rows={2}
                    required
                    placeholder="House / Suite, Street, Block, Area"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>

                <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] flex items-center justify-between font-bold">
                  <span>Order Total (Cash on Delivery)</span>
                  <span className="text-sm text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                    PKR {(activeCheckoutShade.list_price_pkr * checkoutQty).toLocaleString()}
                  </span>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setCheckoutProduct(null)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white font-semibold disabled:opacity-50"
                  >
                    {submitting ? "Placing Order..." : "Confirm Direct Order"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
