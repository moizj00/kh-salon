import React from "react";
import { Award, CheckCircle, DollarSign, TrendingUp } from "lucide-react";

export const RepMonth: React.FC = () => {
  return (
    <div className="bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-4 my-3 shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-[#7a2e4a]" />
          <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
            November 2026 Target
          </h3>
        </div>
        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded">
          On Track
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 text-center">
        <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330]">
          <div className="flex items-center justify-center text-[#6b625e] mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 mr-1" />
            <span className="text-[10px] uppercase font-semibold">Visits</span>
          </div>
          <div className="text-lg font-bold tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
            38<span className="text-xs font-normal text-[#6b625e]">/50</span>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330]">
          <div className="flex items-center justify-center text-[#6b625e] mb-1">
            <DollarSign className="w-3.5 h-3.5 text-amber-600 mr-1" />
            <span className="text-[10px] uppercase font-semibold">Cash Recv</span>
          </div>
          <div className="text-lg font-bold tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
            PKR 142k
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330]">
          <div className="flex items-center justify-center text-[#6b625e] mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-600 mr-1" />
            <span className="text-[10px] uppercase font-semibold">Orders</span>
          </div>
          <div className="text-lg font-bold tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
            19
          </div>
        </div>
      </div>
    </div>
  );
};
