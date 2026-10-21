import type { Account, Category, Transaction, TxKind } from "@/lib/types";

// 统计口径（文档 §6.6.2，所有统计页面统一）：
// - 转账不计入收入与支出
// - 只计入 deletedAt 为空的记录
// - 按发生日期统计
// - 金额单位：分

export interface Summary {
  income: number;
  expense: number;
  balance: number; // 收入 − 支出
}

export function isIncluded(txn: Transaction): boolean {
  return txn.deletedAt === null && txn.kind !== "transfer";
}

export function summarize(txns: Transaction[]): Summary {
  let income = 0;
  let expense = 0;
  for (const txn of txns) {
    if (!isIncluded(txn)) continue;
    if (txn.kind === "income") income += txn.amount;
    else expense += txn.amount;
  }
  return { income, expense, balance: income - expense };
}

export interface CategoryShare {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  amount: number; // 分（含子分类）
  count: number;
  ratio: number; // 0–100，合计 100（舍入误差计入最大项）
}

/** 分类占比：只统计一级分类，金额合并其子分类 */
export function categoryBreakdown(
  txns: Transaction[],
  categories: Category[],
  kind: Exclude<TxKind, "transfer">,
): CategoryShare[] {
  const topLevel = new Map<string, Category>();
  const parentOf = new Map<string, string>();
  for (const category of categories) {
    if (category.deletedAt || category.kind !== kind) continue;
    if (category.parentId === null) topLevel.set(category.id, category);
    else parentOf.set(category.id, category.parentId);
  }

  const amounts = new Map<string, { amount: number; count: number }>();
  for (const txn of txns) {
    if (!isIncluded(txn) || txn.kind !== kind || !txn.categoryId) continue;
    const direct = topLevel.has(txn.categoryId)
      ? txn.categoryId
      : (parentOf.get(txn.categoryId) ?? null);
    if (!direct) continue;
    const entry = amounts.get(direct) ?? { amount: 0, count: 0 };
    entry.amount += txn.amount;
    entry.count += 1;
    amounts.set(direct, entry);
  }

  const total = [...amounts.values()].reduce(
    (sum, entry) => sum + entry.amount,
    0,
  );
  const shares: CategoryShare[] = [];
  for (const [categoryId, entry] of amounts) {
    const category = topLevel.get(categoryId);
    if (!category) continue;
    shares.push({
      categoryId,
      name: category.name,
      icon: category.icon,
      color: category.color,
      amount: entry.amount,
      count: entry.count,
      ratio: total > 0 ? (entry.amount / total) * 100 : 0,
    });
  }
  shares.sort((a, b) => b.amount - a.amount);
  distributeRatioRemainder(shares);
  return shares;
}

/** 舍入误差计入金额最大的一项，保证合计 100% */
function distributeRatioRemainder(shares: CategoryShare[]): void {
  if (shares.length === 0) return;
  const sumOfRounded = shares.reduce(
    (sum, share) => sum + Math.round(share.ratio),
    0,
  );
  const remainder = 100 - sumOfRounded;
  shares[0].ratio = Math.round(shares[0].ratio) + remainder;
  for (let i = 1; i < shares.length; i++) {
    shares[i].ratio = Math.round(shares[i].ratio);
  }
}

export interface MonthPoint {
  ym: string; // 'YYYY-MM'
  income: number;
  expense: number;
}

/** 近 N 个月收支趋势（含当月），按月份升序 */
export function monthlyTrend(
  txns: Transaction[],
  endYm: string,
  months: number,
): MonthPoint[] {
  const keys: string[] = [];
  const [endYear, endMonth] = endYm.split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(endYear, endMonth - 1 - i, 1);
    keys.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  const byMonth = new Map<string, { income: number; expense: number }>(
    keys.map((key) => [
      key,
      { income: 0, expense: 0 } as { income: number; expense: number },
    ]),
  );
  for (const txn of txns) {
    if (!isIncluded(txn)) continue;
    const ym = txn.occurredOn.slice(0, 7);
    const point = byMonth.get(ym);
    if (!point) continue;
    if (txn.kind === "income") point.income += txn.amount;
    else point.expense += txn.amount;
  }
  return keys.map((ym) => {
    const point = byMonth.get(ym) ?? { income: 0, expense: 0 };
    return { ym, ...point };
  });
}

/** 账户余额 = 初始余额 + 收入 − 支出 + 转入 − 转出 */
export function accountBalance(account: Account, txns: Transaction[]): number {
  let balance = account.openingBalance;
  for (const txn of txns) {
    if (txn.deletedAt) continue;
    if (txn.kind === "income" && txn.accountId === account.id)
      balance += txn.amount;
    else if (txn.kind === "expense" && txn.accountId === account.id)
      balance -= txn.amount;
    else if (txn.kind === "transfer") {
      if (txn.accountId === account.id) balance -= txn.amount;
      if (txn.toAccountId === account.id) balance += txn.amount;
    }
  }
  return balance;
}

export interface DailyAmount {
  date: string;
  amount: number;
}

/** 指定区间内每日支出（用于近 7 日柱状图等） */
export function dailyExpense(
  txns: Transaction[],
  from: string,
  to: string,
): DailyAmount[] {
  const byDate = new Map<string, number>();
  for (const txn of txns) {
    if (!isIncluded(txn) || txn.kind !== "expense") continue;
    if (txn.occurredOn < from || txn.occurredOn > to) continue;
    byDate.set(txn.occurredOn, (byDate.get(txn.occurredOn) ?? 0) + txn.amount);
  }
  const days: DailyAmount[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const [ey, em, ed] = to.split("-").map(Number);
  const end = new Date(ey, em - 1, ed).getTime();
  for (
    let cursor = new Date(y, m - 1, d);
    cursor.getTime() <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    days.push({ date: iso, amount: byDate.get(iso) ?? 0 });
  }
  return days;
}
