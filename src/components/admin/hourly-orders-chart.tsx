"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface ChartHourData {
  hour?: number;
  hourLabel: string;
  count: number;
}

interface HourlyOrdersChartProps {
  data: ChartHourData[];
}

export function HourlyOrdersChart({ data }: HourlyOrdersChartProps) {
  return (
    <div className="h-[280px] w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
          <XAxis
            dataKey="hourLabel"
            tick={{ fontSize: 11 }}
            interval={2}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="rounded-lg border bg-popover p-2 shadow-md text-xs">
                    <p className="font-bold">{payload[0].payload.hourLabel} IST</p>
                    <p className="text-primary font-semibold">
                      {payload[0].value} orders
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar
            dataKey="count"
            fill="var(--color-primary, #18181b)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
