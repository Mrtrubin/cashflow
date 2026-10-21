"use client";

import Link from "next/link";
import { categoryLabel } from "@/components/category-picker";
import { formatCents } from "@/lib/money";
import type { Account, Category, Transaction } from "@/lib/types";

/** 明细行：图标 + 分类/备注 + 账户 + 金额（支出 −、收入 +、转账 ⇄），点击进入编辑 */
export function TxnRow({
  txn,
  accounts,
  categories,
}: {
  txn: Transaction;
  accounts: Account[];
  categories: Category[];
}) {
  const label = categoryLabel(txn.categoryId, categories);
  const account = accounts.find((a) => a.id === txn.accountId);
  const toAccount = accounts.find((a) => a.id === txn.toAccountId);
  const title =
    txn.note || label?.name || (txn.kind === "transfer" ? "转账" : "记录");

  const amountText =
    txn.kind === "income"
      ? `+${formatCents(txn.amount)}`
      : txn.kind === "expense"
        ? `−${formatCents(txn.amount)}`
        : `${formatCents(txn.amount)}`;

  return (
    <Link
      href={`/records/new?id=${txn.id}`}
      className="flex min-h-14 items-center gap-3 px-1 py-2"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
        style={{ backgroundColor: `${label?.color ?? "#94a3b8"}22` }}
      >
        {txn.kind === "transfer" ? "⇄" : (label?.icon ?? "📦")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {txn.kind === "transfer"
            ? `${account?.name ?? "?"} → ${toAccount?.name ?? "?"}`
            : `${label?.name ?? "未分类"} · ${account?.name ?? "?"}`}
        </span>
      </span>
      <span
        className={`shrink-0 text-sm font-semibold tabular-nums ${
          txn.kind === "income"
            ? "text-emerald-600 dark:text-emerald-400"
            : txn.kind === "expense"
              ? "text-foreground"
              : "text-muted-foreground"
        }`}
      >
        {amountText}
      </span>
    </Link>
  );
}
