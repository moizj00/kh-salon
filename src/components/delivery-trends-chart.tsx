import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import {
  buildLast30DaysDeliveryTrends,
  type DailyDeliveryTrendPoint,
} from "../lib/delivery-trends";
import type { DeliveryOrderFull } from "../server/types";

interface DeliveryTrendsChartProps {
  orders: DeliveryOrderFull[];
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: DailyDeliveryTrendPoint;
  }>;
}

const TrendsTooltip: React.FC<ChartTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-md px-3 py-2 text-xs space-y-1">
      <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec]">
        {point.label} ({point.dateKey})
      </div>
      <div className="flex items-center justify-between gap-4 text-emerald-700 dark:text-emerald-400">
        <span>Delivered:</span>
        <strong className="tabular-nums">{point.deliveredCount}</strong>
      </div>
      <div className="flex items-center justify-between gap-4 text-amber-700 dark:text-amber-300">
        <span>Pending:</span>
        <strong className="tabular-nums">{point.pendingCount}</strong>
      </div>
      <div className="pt-1 border-t border-[#e6dfdb]/70 dark:border-[#3a3330] flex items-center justify-between gap-4 text-[#6b625e] dark:text-[#a59b96]">
        <span>Completed Value:</span>
        <strong className="tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
          PKR {point.completedRevenuePkr.toLocaleString()}
        </strong>
      </div>
    </div>
  );
};

export const DeliveryTrendsChart: React.FC<DeliveryTrendsChartProps> = ({ orders }) => {
  const summary = useMemo(() => buildLast30DaysDeliveryTrends(orders), [orders]);

  return (
    <div
      className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-3"
      data-testid="delivery-trends-chart-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
            <span>30-Day Order Completion Trends</span>
          </h3>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96] mt-0.5">
            Daily completed salon deliveries vs. open pending orders over the last 30 days
          </p>
        </div>

        <div className="flex items-center gap-5 text-xs">
          <div>
            <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">30d Completed</div>
            <div className="font-bold text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
              {summary.totalDelivered30d}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Open Pending</div>
            <div className="font-bold text-sm tabular-nums text-amber-700 dark:text-amber-300">
              {summary.totalPending30d}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">Completion Rate</div>
            <div className="font-bold text-sm tabular-nums text-[#7a2e4a] dark:text-[#d77a9c]">
              {summary.completionRatePct}%
            </div>
          </div>
        </div>
      </div>

      <div className="h-56 w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={summary.days}
            margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            barCategoryGap="22%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e6dfdb" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#6b625e" }}
              tickLine={false}
              axisLine={{ stroke: "#e6dfdb" }}
              interval={4}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "#6b625e" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<TrendsTooltip />} cursor={{ fill: "rgba(122, 46, 74, 0.06)" }} />
            <Legend
              wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              iconType="circle"
              iconSize={8}
            />
            <Bar
              dataKey="deliveredCount"
              name="Completed Deliveries"
              stackId="orders"
              fill="#059669"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="pendingCount"
              name="Pending Orders"
              stackId="orders"
              fill="#d97706"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
