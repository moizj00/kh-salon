import mocheqiShampooImg from "../assets/images/mocheqi_musk_shampoo_1794772590225.jpg";
import mocheqiMaskImg from "../assets/images/mocheqi_musk_mask_1794772590179.jpg";
import mocheqiSerumImg from "../assets/images/mocheqi_musk_serum_1794772590597.jpg";
import lumexClarifyingImg from "../assets/images/lumex_clarifying_shampoo_1794772590604.jpg";
import lumexKeratinImg from "../assets/images/lumex_keratin_treatment_1794772591510.jpg";
import lumexToningImg from "../assets/images/lumex_toning_shampoo_1794772591351.jpg";
import kemonShampooImg from "../assets/images/kemon_color_shampoo_bottle_1794525597500.jpg";
import kiranKeratinImg from "../assets/images/kiran_keratin_complex_bottle_1794525598009.jpg";
import lunexBleachImg from "../assets/images/lunex_bleach_powder_tub_1794525597118.jpg";
import muskColorImg from "../assets/images/musk_hair_color_cream_1794525597659.jpg";
import type { SKU } from "./data";

export const PRODUCT_IMAGE_PRESETS = [
  { key: "lumex-clarifying", label: "Lumex Clarifying Dispenser", src: lumexClarifyingImg },
  { key: "lumex-keratin", label: "Lumex Keratin & Botox Bottle", src: lumexKeratinImg },
  { key: "lumex-toning", label: "Lumex Violet Toning Bottle", src: lumexToningImg },
  { key: "mocheqi-shampoo", label: "Mocheqi Musk Shampoo Bottle", src: mocheqiShampooImg },
  { key: "mocheqi-mask", label: "Mocheqi Musk Treatment Tub", src: mocheqiMaskImg },
  { key: "mocheqi-serum", label: "Mocheqi Musk Repair Serum", src: mocheqiSerumImg },
  { key: "musk-color", label: "Musk Color Cream Tube", src: muskColorImg },
  { key: "lunex-bleach", label: "Lunex Lightening Tub", src: lunexBleachImg },
  { key: "kemon-shampoo", label: "Kemon Color Care Bottle", src: kemonShampooImg },
  { key: "kiran-keratin", label: "Kiran Keratin Complex Bottle", src: kiranKeratinImg },
] as const;

const IMAGE_BY_KEY: Record<string, string> = Object.fromEntries(
  PRODUCT_IMAGE_PRESETS.map((preset) => [preset.key, preset.src]),
);

export function resolveProductImage(
  sku: Pick<SKU, "image_key" | "brand" | "category" | "name" | "product_type">,
): string {
  if (sku.image_key && IMAGE_BY_KEY[sku.image_key]) {
    return IMAGE_BY_KEY[sku.image_key];
  }

  const hint = `${sku.brand ?? ""} ${sku.name} ${sku.product_type ?? ""} ${sku.category}`.toLowerCase();

  if (hint.includes("lumex")) {
    if (hint.includes("ton") || hint.includes("violet") || hint.includes("blonde")) return lumexToningImg;
    if (hint.includes("keratin") || hint.includes("botox") || hint.includes("treatment")) return lumexKeratinImg;
    if (hint.includes("serum") || hint.includes("gloss") || hint.includes("oil")) return mocheqiSerumImg;
    return lumexClarifyingImg;
  }

  if (hint.includes("mocheqi") || hint.includes("musk")) {
    if (hint.includes("mask") || hint.includes("tub") || hint.includes("jar")) return mocheqiMaskImg;
    if (hint.includes("serum") || hint.includes("oil") || hint.includes("elixir")) return mocheqiSerumImg;
    if (hint.includes("color") || hint.includes("cream") || hint.includes("tube")) return muskColorImg;
    return mocheqiShampooImg;
  }

  if (hint.includes("lunex") || hint.includes("bleach") || hint.includes("decolor")) {
    return lunexBleachImg;
  }
  if (hint.includes("kemon")) return kemonShampooImg;
  if (hint.includes("keratin")) return kiranKeratinImg;
  if (hint.includes("mask")) return mocheqiMaskImg;
  if (hint.includes("serum") || hint.includes("oil")) return mocheqiSerumImg;
  if (hint.includes("color")) return muskColorImg;
  return lumexClarifyingImg;
}
