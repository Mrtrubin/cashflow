"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TxnRow } from "@/components/txn-row";
import {
  currentYm,
  formatYmCn,
  ymKeyToRange,
  ymShift,
  ymToKey,
} from "@/lib/date";
import { formatCents } from "@/lib/money";
import { summarize } from "@/lib/stats";
import { useLedger } from "@/lib/use-ledger";

export default function HomePage() {
  const ledger = useLedger();
  const [monthOffset, setMonthOffset] = useState(0);

  const ym = ymShift(currentYm(), monthOffset);
  const { from, to } = ymKeyToRange(ymToKey(ym));

  const summary = useMemo(() => {
    if (!ledger) return null;
    const monthTxns = ledger.transactions.filter(
      (t) => !t.deletedAt && t.occurredOn >= from && t.occurredOn <= to,
    );
    return summarize(monthTxns);
  }, [ledger, from, to]);

  const recent = useMemo(() => {
    if (!ledger) return [];
    return ledger.transactions.filter((t) => !t.deletedAt).slice(0, 5);
  }, [ledger]);

  if (!ledger || !summary) {
    return (
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        加载中…
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3">
      {/* 本月概览（HOME-01）：左右切换月份 */}
      <section aria-label="本月概览">
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            aria-label="上一月"
            onClick={() => setMonthOffset(monthOffset - 1)}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <span className="text-sm font-medium tabular-nums">
            {formatYmCn(ym)}
          </span>
          <button
            type="button"
            aria-label="下一月"
            disabled={monthOffset >= 0}
            onClick={() => setMonthOffset(monthOffset + 1)}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground disabled:opacity-30"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 rounded-2xl bg-muted/60 px-5 py-4">
          <p className="text-xs text-muted-foreground">本月结余</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {summary.balance < 0 ? "−" : ""}
            {formatCents(Math.abs(summary.balance))}
          </p>
          <div className="mt-3 flex gap-6 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">收入 </span>
              <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCents(summary.income)}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">支出 </span>
              <span className="font-medium tabular-nums">
                {formatCents(summary.expense)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 最近记录（HOME-02） */}
      <section aria-label="最近记录">
        <div className="flex items-center justify-between pb-1">
          <h2 className="text-sm font-semibold text-muted-foreground">
            最近记录
          </h2>
          <Link href="/records" className="text-xs text-muted-foreground">
            查看全部
          </Link>
        </div>
        <div className="divide-y divide-border/60">
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有记录，点下方 + 记第一笔吧
            </p>
          ) : (
            recent.map((txn) => (
              <TxnRow
                key={txn.id}
                txn={txn}
                accounts={ledger.accounts}
                categories={ledger.categories}
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}
