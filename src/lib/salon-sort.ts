import type { Salon } from "./data.ts";

export type SalonSortKey = "name_asc" | "last_visited" | "balance_desc";

export const SALON_SORT_OPTIONS: ReadonlyArray<{ value: SalonSortKey; label: string }> = [
  { value: "name_asc", label: "Name (A-Z)" },
  { value: "last_visited", label: "Last Visited" },
  { value: "balance_desc", label: "Outstanding Balance" },
];

function parseVisitTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : null;
}

export function sortSalons<
  T extends Pick<Salon, "name" | "last_visited_at" | "outstanding_balance">,
>(salons: readonly T[], sortKey: SalonSortKey): T[] {
  const copy = [...salons];

  const compareNames = (a: T, b: T): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  switch (sortKey) {
    case "last_visited":
      return copy.sort((a, b) => {
        const tsA = parseVisitTimestamp(a.last_visited_at);
        const tsB = parseVisitTimestamp(b.last_visited_at);
        if (tsA !== null && tsB !== null) {
          if (tsB !== tsA) return tsB - tsA;
          return compareNames(a, b);
        }
        if (tsA !== null) return -1;
        if (tsB !== null) return 1;
        return compareNames(a, b);
      });

    case "balance_desc":
      return copy.sort((a, b) => {
        const diff = (b.outstanding_balance || 0) - (a.outstanding_balance || 0);
        if (diff !== 0) return diff;
        return compareNames(a, b);
      });

    case "name_asc":
    default:
      return copy.sort(compareNames);
  }
}
