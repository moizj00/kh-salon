import type { OrderCardRecord } from "../server/types.ts";

export type OrderCardBulkDecision = "approve" | "reject";

export interface SelectedOrderCardsSummary {
  selectedCards: OrderCardRecord[];
  selectedCount: number;
  totalUnits: number;
  totalAmountPkr: number;
  distinctSalonsCount: number;
}

export function summarizeSelectedOrderCards(
  pendingCards: readonly OrderCardRecord[],
  selectedIds: readonly string[],
): SelectedOrderCardsSummary {
  const idSet = new Set(selectedIds);
  const selectedCards = pendingCards.filter(
    (card) => card.status === "pending_approval" && idSet.has(card.id),
  );

  let totalUnits = 0;
  let totalAmountPkr = 0;
  const salonIds = new Set<string>();

  for (const card of selectedCards) {
    totalUnits += Number(card.qty || 0);
    totalAmountPkr += Number(card.totalAmount || 0);
    if (card.salonId) {
      salonIds.add(card.salonId);
    }
  }

  return {
    selectedCards,
    selectedCount: selectedCards.length,
    totalUnits,
    totalAmountPkr,
    distinctSalonsCount: salonIds.size,
  };
}
