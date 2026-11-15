import { jsPDF } from "jspdf";
import { when } from "./time.ts";
import type { DeliveryOrderFull, SalonWithApproval } from "../server/types.ts";

export interface ReceiptPdfLineItem {
  skuName: string;
  qty: number;
  unitPriceFormatted: string;
  lineTotalFormatted: string;
}

export interface DeliveryReceiptPdfModel {
  filename: string;
  companyHeader: string;
  orderNumber: string;
  statusLabel: string;
  timestampLabel: string;
  acknowledgementLabel: string;
  salonName: string;
  salonAddress: string;
  salonPhone: string;
  items: ReceiptPdfLineItem[];
  invoiceTotalFormatted: string;
  notes: string | null;
}

export function buildDeliveryReceiptPdfModel(
  order: DeliveryOrderFull,
  salon?: SalonWithApproval | null,
): DeliveryReceiptPdfModel {
  const isDelivered = order.status === "delivered";
  const safeOrderNum = (order.order_number || order.id || "receipt").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const timestampLabel = isDelivered
    ? `Delivered ${order.delivered_at ? when(order.delivered_at) : ""}`.trim()
    : `Confirmed ${order.created_at ? when(order.created_at) : "for dispatch"}`.trim();

  const acknowledgementLabel = order.signature_data
    ? "Customer digital signature attached"
    : isDelivered
      ? "Confirmed by Owner / Office Manager"
      : "Awaiting delivery sign-off";

  const items: ReceiptPdfLineItem[] = (order.items || []).map((it) => {
    const qty = Number(it.qty || 0);
    const price = Number(it.price || 0);
    return {
      skuName: it.sku_name,
      qty,
      unitPriceFormatted: `PKR ${price.toLocaleString()}`,
      lineTotalFormatted: `PKR ${(qty * price).toLocaleString()}`,
    };
  });

  return {
    filename: `Lumex-Receipt-${safeOrderNum}.pdf`,
    companyHeader: "Lumex - Official Delivery Receipt",
    orderNumber: order.order_number,
    statusLabel: isDelivered ? "Delivered" : "Pending Delivery",
    timestampLabel,
    acknowledgementLabel,
    salonName: order.salon_name,
    salonAddress: salon?.address || "",
    salonPhone: salon?.phone || "",
    items,
    invoiceTotalFormatted: `PKR ${Number(order.total_amount || 0).toLocaleString()}`,
    notes: order.notes?.trim() ? order.notes.trim() : null,
  };
}

export function createDeliveryReceiptPdfDocument(
  order: DeliveryOrderFull,
  salon?: SalonWithApproval | null,
): { doc: jsPDF; model: DeliveryReceiptPdfModel } {
  const model = buildDeliveryReceiptPdfModel(order, salon);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageWidth = 210;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = 18;

  // Brand top bar accent
  doc.setFillColor(122, 46, 74); // #7a2e4a
  doc.rect(margin, y, contentWidth, 1.5, "F");
  y += 8;

  // Company & Order Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(122, 46, 74);
  doc.text(model.companyHeader, margin, y);
  y += 7;

  doc.setFont("courier", "bold");
  doc.setFontSize(16);
  doc.setTextColor(29, 26, 25);
  doc.text(model.orderNumber, margin, y);

  // Right-aligned status
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  if (order.status === "delivered") {
    doc.setTextColor(4, 120, 87); // emerald-700
  } else {
    doc.setTextColor(180, 83, 9); // amber-700
  }
  doc.text(model.statusLabel, pageWidth - margin, y, { align: "right" });
  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(107, 98, 94);
  doc.text(model.timestampLabel, margin, y);
  doc.text(model.acknowledgementLabel, pageWidth - margin, y, { align: "right" });
  y += 7;

  // Divider
  doc.setDrawColor(230, 223, 219);
  doc.setLineWidth(0.35);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  // Billed & Delivered To
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(107, 98, 94);
  doc.text("Billed & Delivered To", margin, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(29, 26, 25);
  const salonNameLines = doc.splitTextToSize(model.salonName, contentWidth);
  doc.text(salonNameLines, margin, y);
  y += salonNameLines.length * 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(107, 98, 94);
  if (model.salonAddress) {
    const addrLines = doc.splitTextToSize(model.salonAddress, contentWidth);
    doc.text(addrLines, margin, y);
    y += addrLines.length * 4.5;
  }
  if (model.salonPhone) {
    doc.setFont("courier", "normal");
    doc.text(`Tel: ${model.salonPhone}`, margin, y);
    y += 5;
  }
  y += 4;

  // Table header
  const colItemX = margin;
  const colQtyX = 128;
  const colUnitX = 158;
  const colTotalX = pageWidth - margin;

  doc.setFillColor(250, 247, 245);
  doc.rect(margin, y, contentWidth, 8, "F");
  doc.setDrawColor(230, 223, 219);
  doc.line(margin, y + 8, pageWidth - margin, y + 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(107, 98, 94);
  doc.text("Item", colItemX + 2, y + 5.5);
  doc.text("Qty", colQtyX, y + 5.5, { align: "right" });
  doc.text("Unit", colUnitX, y + 5.5, { align: "right" });
  doc.text("Line Total", colTotalX - 2, y + 5.5, { align: "right" });
  y += 12;

  // Table rows
  for (const item of model.items) {
    const wrappedName = doc.splitTextToSize(item.skuName, 98);
    const rowHeight = Math.max(7, wrappedName.length * 4.8 + 3);

    if (y + rowHeight > 265) {
      doc.addPage();
      y = 20;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(29, 26, 25);
    doc.text(wrappedName, colItemX + 2, y);
    doc.text(String(item.qty), colQtyX, y, { align: "right" });
    doc.text(item.unitPriceFormatted, colUnitX, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(item.lineTotalFormatted, colTotalX - 2, y, { align: "right" });

    y += rowHeight;
    doc.setDrawColor(240, 235, 232);
    doc.line(margin, y - 2, pageWidth - margin, y - 2);
  }

  // Invoice Total Row
  y += 3;
  doc.setDrawColor(230, 223, 219);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(29, 26, 25);
  doc.text("Invoice Total", colUnitX, y, { align: "right" });
  doc.setFontSize(13);
  doc.setTextColor(122, 46, 74);
  doc.text(model.invoiceTotalFormatted, colTotalX - 2, y, { align: "right" });
  y += 10;

  // Optional Notes Box
  if (model.notes) {
    const noteLines = doc.splitTextToSize(model.notes, contentWidth - 8);
    const boxHeight = 10 + noteLines.length * 4.5;
    if (y + boxHeight > 270) {
      doc.addPage();
      y = 20;
    }
    doc.setFillColor(250, 247, 245);
    doc.setDrawColor(230, 223, 219);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(107, 98, 94);
    doc.text("Delivery Instructions & Notes", margin + 4, y + 5.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(29, 26, 25);
    doc.text(noteLines, margin + 4, y + 10.5);
    y += boxHeight + 8;
  }

  // Footer
  const footerY = Math.max(y + 6, 275);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(135, 125, 120);
  doc.text(
    `Generated from Lumex DMS · ${model.orderNumber}`,
    margin,
    Math.min(footerY, 285),
  );

  return { doc, model };
}

export function downloadDeliveryReceiptPdf(
  order: DeliveryOrderFull,
  salon?: SalonWithApproval | null,
): string {
  const { doc, model } = createDeliveryReceiptPdfDocument(order, salon);
  doc.save(model.filename);
  return model.filename;
}
