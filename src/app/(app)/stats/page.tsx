"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  currentYm,
  daysInRange,
  formatYmCn,
  todayISO,
  ymKeyToRange,
  ymShift,
  ymToKey,
} from "@/lib/date";
import { formatCents } from "@/lib/money";
import { categoryBreakdown, monthlyTrend, summarize } from "@/lib/stats";
import { useLedger } from "@/lib/use-ledger";
import { cn } from "@/lib/utils";

type PeriodMode = "month" | "year";
type BreakdownKind = "expense" | "income";

export default function StatsPage() {
  const router = useRouter();
  const ledger = useLedger();
  const [mode, setMode] = useState<PeriodMode>("month");
  const [monthOffset, setMonthOffset] = useState(0);
  const [yearOffset, setYearOffset] = useState(0);
  const [breakdownKind, setBreakdownKind] = useState<BreakdownKind>("expense");

  const ym = ymShift(currentYm(), monthOffset);
  const year = new Date().getFullYear() + yearOffset;

  const range = useMemo(() => {
    if (mode === "month") return ymKeyToRange(ymToKey(ym));
    return ymKeyToRange(String(year));
  }, [mode, ym, year]);

  const summary = useMemo(() => {
    if (!ledger) return null;
    const txns = ledger.transactions.filter(
      (t) =>
        !t.deletedAt && t.occurredOn >= range.from && t.occurredOn <= range.to,
    );
    return summarize(txns);
  }, [ledger, range]);

  const shares = useMemo(() => {
    if (!ledger) return [];
    const txns = ledger.transactions.filter(
      (t) =>
        !t.deletedAt && t.occurredOn >= range.from && t.occurredOn <= range.to,
    );
    return categoryBreakdown(txns, ledger.categories, breakdownKind);
  }, [ledger, range, breakdownKind]);

  const trend = useMemo(() => {
    if (!ledger) return [];
    return monthlyTrend(
      ledger.transactions,
      mode === "month" ? ymToKey(ym) : `${year}-12`,
      6,
    ).map((point) => ({
      ...point,
      label: point.ym.slice(5),
      incomeYuan: point.income / 100,
      expenseYuan: point.expense / 100,
    }));
  }, [ledger, mode, ym, year]);

  if (!ledger || !summary) {
    return (
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        加载中…
      </main>
    );
  }

  const today = todayISO();
  const isCurrentPeriod =
    mode === "month"
      ? ymToKey(ym) === ymToKey(currentYm())
      : String(year) === today.slice(0, 4);
  const isFuture =
    mode === "month"
      ? ymToKey(ym) > ymToKey(currentYm())
      : year > Number(today.slice(0, 4));

  // 日均支出口径：周期未结束按已过天数，历史周期按总天数
  const totalDays = daysInRange(range.from, range.to);
  const elapsedDays = isFuture
    ? 0
    : isCurrentPeriod
      ? daysInRange(range.from, today)
      : totalDays;
  const dailyExpense = elapsedDays > 0 ? summary.expense / elapsedDays : null;
  const savingRate =
    summary.income > 0 ? (summary.balance / summary.income) * 100 : null;

  const drillDownHref = (categoryId?: string) =>
    `/records?from=${range.from}&to=${range.to}&kind=${breakdownKind}${categoryId ? `&categoryId=${categoryId}` : ""}`;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">统计</h1>
        <div className="flex rounded-full bg-muted p-1">
          {(["month", "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              className={cn(
                "min-h-8 rounded-full px-3 text-xs font-medium",
                mode === option
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {option === "month" ? "月" : "年"}
            </button>
          ))}
        </div>
      </header>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          aria-label="上一周期"
          onClick={() =>
            mode === "month"
              ? setMonthOffset(monthOffset - 1)
              : setYearOffset(yearOffset - 1)
          }
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium tabular-nums">
          {mode === "month" ? formatYmCn(ym) : `${year}年`}
        </span>
        <button
          type="button"
          aria-label="下一周期"
          disabled={isCurrentPeriod}
          onClick={() =>
            mode === "month"
              ? setMonthOffset(monthOffset + 1)
              : setYearOffset(yearOffset + 1)
          }
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground disabled:opacity-30"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      {/* 核心指标（STA-01） */}
      <section className="grid grid-cols-2 gap-2" aria-label="核心指标">
        <MetricCard
          label="收入"
          value={formatCents(summary.income)}
          tone="income"
        />
        <MetricCard label="支出" value={formatCents(summary.expense)} />
        <MetricCard label="结余" value={formatCents(summary.balance)} />
        <MetricCard
          label="储蓄率"
          value={savingRate === null ? "—" : `${savingRate.toFixed(1)}%`}
        />
        <MetricCard
          label="日均支出"
          value={
            dailyExpense === null ? "—" : formatCents(Math.round(dailyExpense))
          }
          className="col-span-2"
        />
      </section>

      {/* 分类占比（STA-03）：环形图 + 排行 */}
      <section aria-label="分类占比">
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            分类占比
          </h2>
          <div className="flex rounded-full bg-muted p-0.5">
            {(["expense", "income"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setBreakdownKind(option)}
                className={cn(
                  "min-h-7 rounded-full px-3 text-xs font-medium",
                  breakdownKind === option
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {option === "expense" ? "支出" : "收入"}
              </button>
            ))}
          </div>
        </div>

        {shares.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            该周期暂无{breakdownKind === "expense" ? "支出" : "收入"}记录
          </p>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={shares}
                    dataKey="amount"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                    onClick={(entry: { payload?: { categoryId?: string } }) => {
                      if (entry.payload?.categoryId) {
                        router.push(drillDownHref(entry.payload.categoryId));
                      }
                    }}
                  >
                    {shares.map((share) => (
                      <Cell key={share.categoryId} fill={share.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatCents(Number(value))}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ol className="flex flex-col divide-y divide-border/60">
              {shares.map((share, index) => (
                <li key={share.categoryId}>
                  <Link
                    href={drillDownHref(share.categoryId)}
                    className="flex min-h-11 items-center gap-2 px-1 text-sm"
                  >
                    <span className="w-4 text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: share.color }}
                      aria-hidden="true"
                    />
                    <span aria-hidden="true">{share.icon}</span>
                    <span className="flex-1 truncate">{share.name}</span>
                    <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                      {share.ratio}%
                    </span>
                    <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                      {share.count}笔
                    </span>
                    <span className="w-20 text-right font-medium tabular-nums">
                      {formatCents(share.amount)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {/* 近 6 个月收支趋势（STA-04） */}
      <section aria-label="收支趋势">
        <h2 className="pb-2 text-sm font-semibold text-muted-foreground">
          近 6 个月收支
        </h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={trend}
              margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="var(--border)"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                tickFormatter={(value: number) =>
                  value >= 10000
                    ? `${Number((value / 10000).toFixed(1))}万`
                    : String(value)
                }
              />
              <Tooltip
                formatter={(value) =>
                  formatCents(Math.round(Number(value) * 100))
                }
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="incomeYuan"
                name="收入"
                fill="#22c55e"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="expenseYuan"
                name="支出"
                fill="#f97316"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: "income";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-muted/60 px-3 py-2", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "income" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}
