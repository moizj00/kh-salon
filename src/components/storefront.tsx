import React, { useState } from "react";
import { ShoppingBag, Store, ShieldCheck, Tag, ChevronRight, Sparkles, ExternalLink, ArrowRight } from "lucide-react";

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
    image_url: "https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?w=600&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=600&auto=format&fit=crop&q=80",
    min_price_pkr: 3200,
    shades: [
      { id: "sk-kemon-250", code: "KEM-CC-250", variant: "Retail Bottle 250ml", list_price_pkr: 3200 },
      { id: "sk-kemon-1000", code: "KEM-CC-1L", variant: "Salon Salon Size 1L", list_price_pkr: 8900 },
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
    image_url: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&auto=format&fit=crop&q=80",
    min_price_pkr: 6800,
    shades: [
      { id: "sk-krt-500", code: "KRN-KRT-500", variant: "Professional Bottle 500ml", list_price_pkr: 6800 },
    ],
  },
];

export const StorefrontView: React.FC<{
  onOpenSalonOrderModal: (productName: string) => void;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
}> = ({ onOpenSalonOrderModal, showToast }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeProduct, setActiveProduct] = useState<StorefrontProduct | null>(null);
  const [selectedShadeId, setSelectedShadeId] = useState<string | null>(null);

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

  const handleBuyDirect = (product: StorefrontProduct) => {
    showToast(`Redirecting to Shopify Checkout for ${product.name} (PKR ${product.min_price_pkr.toLocaleString()})`, "ok");
  };

  return (
    <div className="space-y-4">
      {/* Brand Storefront Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-[#7a2e4a] to-[#4a182c] text-white shadow-md space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded text-white">
            Official Public Storefront
          </span>
          <span className="text-xs text-amber-200 font-mono">khsalon.com</span>
        </div>

        <div>
          <h2 className="font-extrabold text-lg tracking-tight">KH Enterprises Store</h2>
          <p className="text-xs text-white/80">
            Official Pakistan distributor of Musk, Lunex, Kemon & Kiran Professional.
          </p>
        </div>

        <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-amber-100">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
            <span>Default Market Prices (PKR)</span>
          </div>
          <div className="flex items-center gap-1 font-medium">
            <Store className="w-3.5 h-3.5" />
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
            className={`px-3 py-1.5 rounded-xl font-medium whitespace-nowrap transition-colors ${
              selectedCategory === c.id
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] hover:border-[#7a2e4a]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 gap-3">
        {filtered.map((product) => (
          <div
            key={product.id}
            className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3 hover:border-[#7a2e4a] transition-all"
          >
            <div className="flex gap-3">
              {/* Product Image */}
              <div className="w-20 h-20 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] overflow-hidden shrink-0 relative">
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-full h-full object-cover object-center"
                />
                <span className="absolute top-1 left-1 bg-[#7a2e4a] text-white text-[9px] font-bold px-1.5 py-0.2 rounded">
                  {product.brand_label}
                </span>
              </div>

              {/* Product Copy & Metadata */}
              <div className="flex-1 space-y-1">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] leading-tight">
                    {product.name}
                  </h3>
                </div>

                <p className="text-xs text-[#6b625e] dark:text-[#a59b96] line-clamp-2">
                  {product.meta_description}
                </p>

                <div className="pt-1 flex items-baseline justify-between">
                  <div className="font-extrabold text-sm text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                    PKR {product.min_price_pkr.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-[#6b625e]">
                    {product.shades.length} shade/size option{product.shades.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setActiveProduct(product);
                  setSelectedShadeId(product.shades[0]?.id || null);
                }}
                className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] font-medium hover:border-[#7a2e4a] text-[#1d1a19] dark:text-[#f2eeec]"
              >
                View Details
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenSalonOrderModal(product.name)}
                  className="px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300/40 font-semibold text-[11px] hover:bg-amber-100"
                >
                  Salon Pricing Order
                </button>

                <button
                  type="button"
                  onClick={() => handleBuyDirect(product)}
                  className="px-3 py-1.5 rounded-xl bg-[#7a2e4a] text-white font-semibold flex items-center gap-1 shadow-xs hover:opacity-95 text-[11px]"
                >
                  <span>Buy Direct</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Product Detail Modal */}
      {activeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#7a2e4a] dark:text-[#d77a9c] bg-[#7a2e4a]/10 px-2 py-0.5 rounded">
                  {activeProduct.brand_label}
                </span>
                <h3 className="font-extrabold text-base text-[#1d1a19] dark:text-[#f2eeec] mt-1">
                  {activeProduct.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveProduct(null)}
                className="p-1 text-[#6b625e] hover:text-[#1d1a19]"
              >
                ✕
              </button>
            </div>

            <div className="w-full h-40 rounded-xl overflow-hidden bg-black/5 border">
              <img src={activeProduct.image_url} alt={activeProduct.name} className="w-full h-full object-cover" />
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">Product Details</div>
              <p className="text-[#6b625e] dark:text-[#a59b96] leading-relaxed">{activeProduct.body}</p>

              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] pt-2">How to Use</div>
              <p className="text-[#6b625e] dark:text-[#a59b96] leading-relaxed bg-[#faf7f5] dark:bg-[#171413] p-2.5 rounded-xl border border-[#e6dfdb]/60">
                {activeProduct.how_to_use}
              </p>
            </div>

            {/* Shades / Variants */}
            <div className="space-y-2 text-xs">
              <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">Select Option / Shade</div>
              <div className="grid grid-cols-2 gap-2">
                {activeProduct.shades.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedShadeId(s.id)}
                    className={`p-2 rounded-xl text-left border transition-colors ${
                      selectedShadeId === s.id
                        ? "border-[#7a2e4a] bg-[#7a2e4a]/5 font-bold"
                        : "border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e]"
                    }`}
                  >
                    <div className="text-[11px] truncate">{s.variant}</div>
                    <div className="text-xs text-[#7a2e4a] dark:text-[#d77a9c] font-extrabold tabular-nums">
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
                  setActiveProduct(null);
                  handleBuyDirect(p);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white font-bold text-xs flex items-center justify-center gap-1 shadow-xs"
              >
                <span>Buy Direct</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
