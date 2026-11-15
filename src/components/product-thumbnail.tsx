import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import type { SKU } from "../lib/data";
import { getSkuBrand } from "../lib/catalog";
import { resolveProductImage } from "../lib/product-images";

interface ProductThumbnailProps {
  sku: Pick<SKU, "image_key" | "brand" | "category" | "name" | "product_type">;
  className?: string;
}

export const ProductThumbnail: React.FC<ProductThumbnailProps> = ({
  sku,
  className = "w-11 h-11 rounded-lg",
}) => {
  const [failed, setFailed] = useState(false);
  const src = resolveProductImage(sku);
  const brand = getSkuBrand(sku);
  const initials = brand
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className={`${className} overflow-hidden shrink-0 bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] flex items-center justify-center`}
    >
      {failed ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#7a2e4a]/15 to-[#e6dfdb]/50 dark:from-[#7a2e4a]/30 dark:to-[#171413] text-[#7a2e4a] dark:text-[#d77a9c] select-none">
          <Sparkles className="w-3.5 h-3.5 mb-0.5" aria-hidden="true" />
          <span className="text-[9px] font-bold tracking-wider">{initials || "KH"}</span>
        </div>
      ) : (
        <img
          src={src}
          alt={sku.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover object-center"
        />
      )}
    </div>
  );
};
