"use client";

import { getMeta, setMeta } from "@/lib/db";
import type { ParsedRow } from "@/lib/parse-text";
import type { Category } from "@/lib/types";

// 商户 → 分类的记忆（IMP-09）：
// 导入时用户给「其他」或空分类的行指定了分类，就把「规范化后的商户名 → 分类 id」
// 记在本机，下次解析自动套用，不用再逐行改。
// 只存在本机（Dexie meta），不参与云端同步：不同设备可以有不同的分类习惯。

const HINTS_KEY = "import:categoryHints";
const MAX_HINTS = 500;

export type CategoryHints = Record<string, string>;

/**
 * 把一行备注收敛成「商户主体」，用于跨次匹配：
 * 「消费财付通-美宜佳东北特产15244692」→「美宜佳东北特产」
 * 「消费支付宝-商户_覃韬」→「覃韬」
 * 「消费网银在线-五爷拌面（总部）」→「五爷拌面」
 */
export function hintKey(note: string | null): string | null {
  if (!note) return null;
  const key = note
    .replace(/\s+/g, "")
    .replace(/^(消费|转账|退款|收入|支出)/, "")
    .replace(/^(财付通|支付宝|微信|网银在线|银联|云闪付)[-_—]?/, "")
    .replace(/^商户[-_]?/, "")
    .replace(/[（(][^）)]*[）)]/g, "") // 去掉「（总部）」这类补充说明
    .replace(/[-_—|/·:：]/g, "")
    .replace(/\d+/g, "") // 订单号、门店号
    .replace(/[^\u4e00-\u9fa5a-zA-Z]/g, "")
    .toLowerCase();
  return key.length >= 2 ? key : null;
}

export async function loadHints(): Promise<CategoryHints> {
  const raw = await getMeta(HINTS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const hints: CategoryHints = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string" && value) hints[key] = value;
    }
    return hints;
  } catch {
    return {};
  }
}

/** 合并写入（只增改，不删除）；超过上限时丢最早的 */
export async function saveHints(patch: CategoryHints): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value);
  if (entries.length === 0) return;
  const current = await loadHints();
  for (const [key, value] of entries) {
    current[key] = value;
  }
  const keys = Object.keys(current);
  const kept =
    keys.length > MAX_HINTS
      ? Object.fromEntries(
          keys.slice(keys.length - MAX_HINTS).map((key) => [key, current[key]]),
        )
      : current;
  await setMeta(HINTS_KEY, JSON.stringify(kept));
}

/**
 * 把记住的分类套用到解析结果：只要商户命中记忆就覆盖脚本给的分类
 * （用户手动指定的优先级高于脚本猜测），分类必须存在、未归档、且与收入/支出类型一致。
 * 返回套用的行数。
 */
export function applyHints(
  rows: ParsedRow[],
  hints: CategoryHints,
  categories: Category[],
): number {
  const byId = new Map(categories.map((category) => [category.id, category]));
  let applied = 0;

  for (const row of rows) {
    if (row.status === "error" || row.kind === "transfer") continue;
    const key = hintKey(row.note);
    if (!key) continue;
    const category = byId.get(hints[key] ?? "");
    if (!category || category.deletedAt || category.archived) continue;
    if (row.kind && row.kind !== category.kind) continue;
    if (row.categoryId === category.id) continue;

    const parent = category.parentId ? byId.get(category.parentId) : undefined;
    row.categoryId = category.id;
    row.categoryPath = parent
      ? [parent.name, category.name]
      : [category.name, null];
    row.categoryFromHint = true;
    if (!row.kind) {
      row.kind = category.kind === "income" ? "income" : "expense";
      row.kindSource = "category";
    }
    row.reasons = row.reasons.filter(
      (reason) =>
        reason !== "脚本没有给出分类，需要手动选择" &&
        !reason.startsWith("脚本没有给出类型") &&
        reason !== "类型无法推断",
    );
    if (row.status === "confirm" && row.reasons.length === 0) row.status = "ok";
    applied += 1;
  }

  return applied;
}
