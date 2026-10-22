// 把短信 SDK 的账单结果接到应用现有的「预览 → 导入」流程。
// 复用 buildScriptRow 的分类/账户匹配、重复检测逻辑，避免两套规则。

import type { ParseRule } from "@/lib/parse-rule";
import {
  buildScriptRow,
  type ParseContext,
  type ParsedRow,
} from "@/lib/parse-text";
import type { SmsBillTransaction } from "@/lib/sms-sdk";
import type { Account, Category } from "@/lib/types";

// 短信结果已经是标准 YYYY-MM-DD，不需要用户脚本；保留一个常量规则给
// buildScriptRow 使用（它只读取 dateFormat / 分隔符）。
const SMS_RULE: ParseRule = {
  id: "sms-import",
  name: "短信账单",
  script: "",
  skipHeader: false,
  commentPrefix: "",
  dateFormat: "ymd",
  categorySeparator: "/",
  transferSeparator: ">",
  createdAt: "",
  updatedAt: "",
};

function activeAccounts(accounts: Account[]): Account[] {
  return accounts.filter((account) => !account.deletedAt && !account.archived);
}

function activeCategories(categories: Category[]): Category[] {
  return categories.filter(
    (category) => !category.deletedAt && !category.archived,
  );
}

function findParentCategory(
  categories: Category[],
  name: string,
  kind: SmsBillTransaction["kind"],
): Category | null {
  return (
    activeCategories(categories).find(
      (category) =>
        category.parentId === null &&
        category.name === name &&
        category.kind === kind,
    ) ?? null
  );
}

function chooseCategoryName(
  transaction: SmsBillTransaction,
  categories: Category[],
): string | null {
  const hint = transaction.categoryHint?.trim();
  if (hint) {
    const exact = findParentCategory(categories, hint, transaction.kind);
    if (exact) return exact.name;
  }
  return findParentCategory(categories, "其他", transaction.kind)?.name ?? null;
}

/** 按「银行名 / 卡号后四位 / 钱包名」匹配本机账户；找不到返回 null */
function chooseAccount(
  transaction: SmsBillTransaction,
  accounts: Account[],
): Account | null {
  const active = activeAccounts(accounts);
  const hint = transaction.accountHint?.trim();
  const bank = transaction.bank?.trim();
  const tail = transaction.cardTail?.trim();
  const channel = transaction.channel?.trim();

  if (hint) {
    const exact = active.find((account) => account.name.trim() === hint);
    if (exact) return exact;
    const partial = active.find(
      (account) =>
        account.name.includes(hint) || hint.includes(account.name.trim()),
    );
    if (partial) return partial;
  }

  if (tail) {
    const byTail = active.find((account) => account.name.includes(tail));
    if (byTail) return byTail;
  }

  if (bank) {
    const byBank = active.find(
      (account) =>
        account.name.includes(bank) ||
        bank.includes(account.name.replace(/银行$/, "")),
    );
    if (byBank) return byBank;
    const bankAccounts = active.filter((account) => account.type === "bank");
    if (bankAccounts.length === 1) return bankAccounts[0];
  }

  if (channel) {
    const wallet = channel.includes("微信")
      ? "微信"
      : channel.includes("支付宝")
        ? "支付宝"
        : null;
    if (wallet) {
      const byWallet = active.find((account) => account.name.includes(wallet));
      if (byWallet) return byWallet;
    }
  }

  return null;
}

/** 把短信账单转成现有导入预览行；返回顺序与 transactions 一致 */
export function buildSmsRows(
  transactions: readonly SmsBillTransaction[],
  ctx: ParseContext,
): ParsedRow[] {
  const rows: ParsedRow[] = [];

  transactions.forEach((transaction, index) => {
    const category = chooseCategoryName(transaction, ctx.categories);
    const account = chooseAccount(transaction, ctx.accounts);
    const value: Record<string, unknown> = {
      date: transaction.date,
      time: transaction.time ?? undefined,
      amount: (transaction.amountCents / 100).toFixed(2),
      kind: transaction.kind,
      note: transaction.note,
      tags: transaction.tags,
    };
    if (category) value.category = category;
    if (account) value.account = account.name;

    const row = buildScriptRow(
      transaction.raw,
      index + 1,
      { value, error: null },
      ctx,
      SMS_RULE,
    );
    if (!row) return;

    // 银行短信最好落到专用银行卡；没有匹配账户时仍允许走默认账户，
    // 但把银行/卡号放进标签，预览里能看出这笔钱来自哪张卡。
    if (transaction.bank && !account) {
      row.tags = [...new Set([...row.tags, transaction.bank])];
    }
    rows.push(row);
  });

  return rows;
}

export type { SmsBillTransaction };
