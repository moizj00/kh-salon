import type { DeliveryOrderFull, SalonWithApproval } from "../server/types.ts";

function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildDeliveryOrdersCsv(
  orders: DeliveryOrderFull[],
  salons: SalonWithApproval[],
): string {
  const salonById: Record<string, SalonWithApproval> = {};
  for (const s of salons) {
    salonById[s.id] = s;
  }

  const headers = [
    "Order Number",
    "Order ID",
    "Salon Name",
    "Salon Area",
    "Salon Phone",
    "Status",
    "Items Summary",
    "Total Units",
    "Invoice Total (PKR)",
    "Created At",
    "Delivered At",
    "Verification",
  ];

  const rows = orders.map((ord) => {
    const salon = salonById[ord.salon_id];
    const totalUnits = ord.items.reduce((sum, it) => sum + Number(it.qty || 0), 0);
    const itemsSummary = ord.items.map((it) => `${it.qty}x ${it.sku_name}`).join("; ");
    const statusLabel = ord.status === "delivered" ? "Delivered" : "Pending Delivery";
    const verification =
      ord.status === "delivered"
        ? ord.signature_data
          ? "Digital Signature"
          : "Owner / Office Manager"
        : "Pending";

    return [
      ord.order_number,
      ord.id,
      ord.salon_name,
      salon?.area ?? "",
      salon?.phone ?? "",
      statusLabel,
      itemsSummary,
      totalUnits,
      ord.total_amount,
      ord.created_at ?? "",
      ord.delivered_at ?? "",
      verification,
    ]
      .map(escapeCsvCell)
      .join(",");
  });

  return [headers.map(escapeCsvCell).join(","), ...rows].join("\r\n");
}

export function downloadDeliveryOrdersCsv(
  orders: DeliveryOrderFull[],
  salons: SalonWithApproval[],
  filterLabel: string,
): string {
  const csvBody = buildDeliveryOrdersCsv(orders, salons);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeFilter = filterLabel.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const filename = `kiran-deliveries-${safeFilter}-${dateStamp}.csv`;

  const blob = new Blob(["\uFEFF" + csvBody], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  return filename;
}
