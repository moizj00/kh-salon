import React from "react";
import { Award, CheckCircle, DollarSign, TrendingUp } from "lucide-react";
import type { RepMonthlyStats } from "../server/types";

interface RepMonthProps {
  stats: RepMonthlyStats;
}

function formatPkrCompact(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `PKR ${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `PKR ${amount.toLocaleString()}`;
}

export const RepMonth: React.FC<RepMonthProps> = ({ stats }) => {
  const visitRatio = stats.visitsTarget > 0 ? stats.visitsCompleted / stats.visitsTarget : 0;
  const onTrack = visitRatio >= 0.4;

  return (
    <div className="bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-4 shadow-xs space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Award className="w-5 h-5 text-[#7a2e4a] dark:text-[#d77a9c] shrink-0" />
          <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] truncate">
            {stats.monthLabel}
          </h3>
        </div>
        <span
          className={`text-xs font-semibold shrink-0 ${
            onTrack
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-300"
          }`}
        >
          {onTrack ? "On Track" : "In Progress"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 text-center">
        <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330]">
          <div className="flex items-center justify-center text-[#6b625e] dark:text-[#a59b96] mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 mr-1" />
            <span className="text-[11px] font-semibold">Visits</span>
          </div>
          <div className="text-lg font-bold tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
            {stats.visitsCompleted}
            <span className="text-xs font-normal text-[#6b625e] dark:text-[#a59b96]">
              /{stats.visitsTarget}
            </span>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330]">
          <div className="flex items-center justify-center text-[#6b625e] dark:text-[#a59b96] mb-1">
            <DollarSign className="w-3.5 h-3.5 text-amber-600 mr-1" />
            <span className="text-[11px] font-semibold">Cash Recv</span>
          </div>
          <div className="text-lg font-bold tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
            {formatPkrCompact(stats.cashCollectedPkr)}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330]">
          <div className="flex items-center justify-center text-[#6b625e] dark:text-[#a59b96] mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-600 mr-1" />
            <span className="text-[11px] font-semibold">Orders</span>
          </div>
          <div className="text-lg font-bold tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
            {stats.ordersCount}
          </div>
        </div>
      </div>
    </div>
  );
};
