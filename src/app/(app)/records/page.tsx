"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TxnRow } from "@/components/txn-row";
import {
  daysInRange,
  formatDateCn,
  todayISO,
  ymKeyToRange,
  ymOf,
  ymShift,
  ymToKey,
} from "@/lib/date";
import { formatCents } from "@/lib/money";
import { summarize } from "@/lib/stats";
import type { Account, Category, Transaction, TxKind } from "@/lib/types";
import { useLedger } from "@/lib/use-ledger";
import { cn } from "@/lib/utils";

type PeriodKey = "thisMonth" | "lastMonth" | "thisYear" | "custom";

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: "thisMonth", label: "本月" },
  { key: "lastMonth", label: "上月" },
  { key: "thisYear", label: "本年" },
  { key: "custom", label: "自定义" },
];

const KIND_OPTIONS: Array<{ key: TxKind | "all"; label: string }> = [
  { key: "all", label: "全部" },
  { key: "expense", label: "支出" },
  { key: "income", label: "收入" },
  { key: "transfer", label: "转账" },
];

type Row =
  | {
      type: "header";
      key: string;
      date: string;
      income: number;
      expense: number;
    }
  | { type: "txn"; key: string; txn: Transaction };

export default function RecordsPage() {
  return (
    <Suspense fallback={null}>
      <RecordsContent />
    </Suspense>
  );
}

function RecordsContent() {
  const searchParams = useSearchParams();
  const ledger = useLedger();

  // 支持统计页下钻带入条件：from、to、kind、categoryId（STA-05）
  const [period, setPeriod] = useState<PeriodKey>("thisMonth");
  const [monthOffset, setMonthOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [kindFilter, setKindFilter] = useState<TxKind | "all">("all");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !searchParams.size) return;
    initialized.current = true;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const kind = searchParams.get("kind");
    const categoryId = searchParams.get("categoryId");
    if (from && to) {
      setPeriod("custom");
      setCustomFrom(from);
      setCustomTo(to);
    }
    if (kind && KIND_OPTIONS.some((option) => option.key === kind)) {
      setKindFilter(kind as TxKind | "all");
    }
    if (categoryId) setCategoryIds([categoryId]);
  }, [searchParams]);

  const { from, to } = useMemo((): { from: string; to: string } => {
    if (period === "custom") return { from: customFrom, to: customTo };
    if (period === "thisYear")
      return ymKeyToRange(String(new Date().getFullYear()));
    const ym = ymShift(
      ymOf(todayISO()),
      period === "lastMonth" ? -1 : monthOffset,
    );
    return ymKeyToRange(ymToKey(ym));
  }, [period, monthOffset, customFrom, customTo]);

  const filtered = useMemo(() => {
    if (!ledger) return [];
    const kw = keyword.trim().toLowerCase();
    const parentOf = new Map(
      ledger.categories
        .filter((c) => c.parentId)
        .map((c) => [c.id, c.parentId as string]),
    );
    return ledger.transactions.filter((txn) => {
      if (txn.deletedAt) return false;
      if (txn.occurredOn < from || txn.occurredOn > to) return false;
      if (kindFilter !== "all" && txn.kind !== kindFilter) return false;
      if (categoryIds.length > 0) {
        const txnParent = txn.categoryId
          ? parentOf.get(txn.categoryId)
          : undefined;
        if (
          !txn.categoryId ||
          !categoryIds.some((id) => id === txn.categoryId || id === txnParent)
        ) {
          return false;
        }
      }
      if (kw) {
        const label =
          ledger.categories.find((c) => c.id === txn.categoryId)?.name ?? "";
        const haystack =
          `${txn.note ?? ""} ${txn.payee ?? ""} ${label}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [ledger, from, to, kindFilter, categoryIds, keyword]);

  const summary = useMemo(() => summarize(filtered), [filtered]);

  const rows = useMemo<Row[]>(() => {
    const byDate = new Map<string, Transaction[]>();
    for (const txn of filtered) {
      const list = byDate.get(txn.occurredOn) ?? [];
      list.push(txn);
      byDate.set(txn.occurredOn, list);
    }
    const result: Row[] = [];
    for (const [date, txns] of [...byDate.entries()].sort((a, b) =>
      a[0] < b[0] ? 1 : -1,
    )) {
      const day = summarize(txns);
      result.push({
        type: "header",
        key: `h-${date}`,
        date,
        income: day.income,
        expense: day.expense,
      });
      for (const txn of txns) {
        result.push({ type: "txn", key: txn.id, txn });
      }
    }
    return result;
  }, [filtered]);

  if (!ledger) {
    return (
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        加载中…
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
        <h1 className="text-xl font-semibold">明细</h1>
      </header>

      {/* 顶部汇总（LST-02） */}
      <div className="grid shrink-0 grid-cols-3 gap-2 px-4 pb-2">
        <SummaryCard
          label="收入"
          value={summary.income}
          className="text-emerald-600 dark:text-emerald-400"
        />
        <SummaryCard label="支出" value={summary.expense} />
        <SummaryCard label="结余" value={summary.balance} />
      </div>

      {/* 筛选（LST-03/04/05） */}
      <div className="relative z-20 flex shrink-0 flex-col gap-2 px-4 pb-2">
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as PeriodKey)}
            className="min-h-9 shrink-0 rounded-lg border border-border bg-background px-2 text-sm"
            aria-label="时间筛选"
            name="period"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          {period === "thisMonth" ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="上一月"
                onClick={() => setMonthOffset(monthOffset - 1)}
                className="flex size-9 items-center justify-center rounded-lg bg-muted"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <span className="w-16 text-center text-sm tabular-nums">
                {ymKeyToRange(
                  ymToKey(ymShift(ymOf(todayISO()), monthOffset)),
                ).from.slice(0, 7)}
              </span>
              <button
                type="button"
                aria-label="下一月"
                onClick={() => setMonthOffset(monthOffset + 1)}
                className="flex size-9 items-center justify-center rounded-lg bg-muted"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setCategoryFilterOpen((open) => !open)}
            className={cn(
              "ml-auto min-h-9 shrink-0 rounded-lg border border-border px-3 text-xs",
              categoryIds.length > 0
                ? "border-primary text-primary"
                : "text-muted-foreground",
            )}
          >
            分类{categoryIds.length > 0 ? ` · ${categoryIds.length}` : ""}
          </button>
        </div>

        <div className="relative">
          <Search
            className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜备注、商户、分类"
            aria-label="搜索记录"
            name="keyword"
            className="min-h-9 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-0.5">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setKindFilter(option.key)}
              className={cn(
                "min-h-8 rounded-md text-xs font-medium",
                kindFilter === option.key
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {period === "custom" ? (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="min-h-9 flex-1 rounded-lg border border-border bg-background px-2"
              aria-label="开始日期"
            />
            <span className="text-muted-foreground">至</span>
            <input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="min-h-9 flex-1 rounded-lg border border-border bg-background px-2"
              aria-label="结束日期"
            />
          </div>
        ) : null}

        {categoryFilterOpen ? (
          <div className="absolute inset-x-4 top-full z-30 max-h-64 overflow-y-auto rounded-xl border border-border bg-background p-2 text-sm shadow-lg">
            <button
              type="button"
              onClick={() => setCategoryIds([])}
              className="min-h-8 px-2 text-xs text-muted-foreground"
            >
              清除分类筛选
            </button>
            <CategoryFilterList
              categories={ledger.categories.filter(
                (c) => !c.deletedAt && !c.archived,
              )}
              selected={categoryIds}
              onToggle={(id) =>
                setCategoryIds((current) =>
                  current.includes(id)
                    ? current.filter((x) => x !== id)
                    : [...current, id],
                )
              }
            />
          </div>
        ) : null}
      </div>

      {/* 按日分组的虚拟列表（LST-01/07） */}
      <div className="min-h-0 flex-1 px-4">
        {rows.length === 0 ? (
          <p className="pt-10 text-center text-sm text-muted-foreground">
            没有符合条件的记录（
            {from === to ? formatDateCn(from) : `${from} ~ ${to}`}，共{" "}
            {daysInRange(from, to)} 天）
          </p>
        ) : (
          <VirtualRows
            rows={rows}
            accounts={ledger.accounts}
            categories={ledger.categories}
          />
        )}
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums", className)}>
        {formatCents(value)}
      </p>
    </div>
  );
}

function VirtualRows({
  rows,
  accounts,
  categories,
}: {
  rows: Row[];
  accounts: Account[];
  categories: Category[];
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index].type === "header" ? 40 : 60),
    overscan: 12,
  });

  return (
    <div ref={parentRef} className="h-full overflow-y-auto pb-6">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              {row.type === "header" ? (
                <div className="flex items-center justify-between py-2 text-xs text-muted-foreground">
                  <span>{formatDateCn(row.date)}</span>
                  <span className="tabular-nums">
                    {row.income > 0 ? `收 ${formatCents(row.income)}` : ""}
                    {row.income > 0 && row.expense > 0 ? " · " : ""}
                    {row.expense > 0 ? `支 ${formatCents(row.expense)}` : ""}
                  </span>
                </div>
              ) : (
                <TxnRow
                  txn={row.txn}
                  accounts={accounts}
                  categories={categories}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryFilterList({
  categories,
  selected,
  onToggle,
}: {
  categories: Category[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const tops = categories.filter((c) => c.parentId === null);
  return (
    <div className="flex flex-col">
      {tops.map((top) => (
        <div key={top.id}>
          <CheckboxRow
            label={`${top.icon} ${top.name}`}
            checked={selected.includes(top.id)}
            onToggle={() => onToggle(top.id)}
          />
          {categories
            .filter((c) => c.parentId === top.id)
            .map((child) => (
              <div key={child.id} className="pl-5">
                <CheckboxRow
                  label={child.name}
                  checked={selected.includes(child.id)}
                  onToggle={() => onToggle(child.id)}
                />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 px-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4"
      />
      {label}
    </label>
  );
}
