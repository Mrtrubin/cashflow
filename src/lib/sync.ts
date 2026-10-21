"use client";

import { apiFetch } from "@/lib/api/client";
import { authClient } from "@/lib/auth/client";
import {
  dropOutbox,
  enqueueChanges,
  getDb,
  getMeta,
  type OutboxItem,
  pendingEntityIds,
  saveDeviceSettings,
  setMeta,
  takeOutbox,
} from "@/lib/db";
import type {
  Account,
  Budget,
  Category,
  ImportBatch,
  Transaction,
  UserSettings,
} from "@/lib/types";

// 同步引擎（文档 §8.2）：
//   推送：outbox 中待上传的变更按「账户 → 分类 → 导入批次 → 记录 → 预算 → 设置」顺序提交，
//         每批 ≤200 条；服务端返回已接收的 id 后出队。
//   拉取：按 updated_at 游标增量拉取（游标回看 5 秒），本机仍有未推送修改的记录不被覆盖。
//   冲突：最后到达服务端的版本生效；删除优先（服务端触发器保证）。
// 网络与鉴权全部经由 Next 的 /api/v1/*，浏览器不接触数据库。

const CURSOR_KEY = "sync:cursor";
const BOOTSTRAP_KEY = "sync:bootstrapped";
const LOOKBACK_MS = 5_000;
const PUSH_BATCH = 200;
const MAX_PULL_ROUNDS = 10;
const MAX_PUSH_ROUNDS = 20;

type OutboxEntity = OutboxItem["entity"];

const PAYLOAD_KEY: Record<OutboxEntity, string> = {
  account: "accounts",
  category: "categories",
  import_batch: "importBatches",
  transaction: "transactions",
  budget: "budgets",
  settings: "settings",
};

interface PushResponse {
  applied: Record<string, string[]>;
  rejected: Array<{ entity: string; id: string; reason: string }>;
}

interface PullResponse {
  cursor: string;
  hasMore: boolean;
  accounts: Account[];
  categories: Category[];
  importBatches: ImportBatch[];
  transactions: Transaction[];
  budgets: Budget[];
  settings: UserSettings | null;
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  rejected: number;
  at: string;
}

let running: Promise<SyncOutcome> | null = null;

/** 是否已登录（同步只在登录后运行） */
export async function hasSession(): Promise<boolean> {
  const { data } = await authClient.getSession();
  return Boolean(data?.user);
}

async function loadRow(
  entity: OutboxEntity,
  id: string,
): Promise<Account | Category | Transaction | Budget | ImportBatch | null> {
  const db = await getDb();
  switch (entity) {
    case "account":
      return (await db.accounts.get(id)) ?? null;
    case "category":
      return (await db.categories.get(id)) ?? null;
    case "import_batch":
      return (await db.importBatches.get(id)) ?? null;
    case "transaction":
      return (await db.transactions.get(id)) ?? null;
    case "budget":
      return (await db.budgets.get(id)) ?? null;
    default:
      return null;
  }
}

async function pushOnce(): Promise<{ count: number; rejected: number } | null> {
  const items = await takeOutbox(PUSH_BATCH);
  if (items.length === 0) return null;

  const db = await getDb();
  // 同一实体的多次修改合并成一条（以最新一次为准）
  const latest = new Map<string, OutboxItem>();
  for (const item of items) {
    latest.set(`${item.entity}:${item.entityId}`, item);
  }

  const payload: Record<string, unknown> = {};
  for (const item of latest.values()) {
    if (item.entity === "settings") {
      const row = await db.deviceSettings.get("app");
      payload.settings = row
        ? {
            defaultAccountId: row.defaultAccountId,
            periodStartDay: row.periodStartDay,
            updatedAt: new Date().toISOString(),
          }
        : null;
      continue;
    }
    const row = await loadRow(item.entity, item.entityId);
    if (!row) continue; // 本机已物理删除，无需上传
    const key = PAYLOAD_KEY[item.entity];
    const list = (payload[key] as unknown[] | undefined) ?? [];
    list.push(row);
    payload[key] = list;
  }

  const result = await apiFetch<PushResponse>("/api/v1/sync/push", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  await dropOutbox(
    items
      .map((item) => item.seq)
      .filter((seq): seq is number => typeof seq === "number"),
  );

  if (result.rejected.length > 0) {
    console.warn("[sync] 部分变更被服务端拒绝", result.rejected);
  }
  return { count: items.length, rejected: result.rejected.length };
}

interface PullPage {
  count: number;
  /** 任一实体取满一页，说明后面还有数据 */
  full: boolean;
}

async function pullOnce(): Promise<PullPage> {
  const cursor = await getMeta(CURSOR_KEY);
  const since = cursor
    ? new Date(new Date(cursor).getTime() - LOOKBACK_MS).toISOString()
    : new Date(0).toISOString();

  const data = await apiFetch<PullResponse>(
    `/api/v1/sync/pull?cursor=${encodeURIComponent(since)}`,
  );

  const db = await getDb();
  const [
    pendingAccounts,
    pendingCategories,
    pendingBatches,
    pendingTxns,
    pendingBudgets,
    pendingSettings,
  ] = await Promise.all([
    pendingEntityIds("account"),
    pendingEntityIds("category"),
    pendingEntityIds("import_batch"),
    pendingEntityIds("transaction"),
    pendingEntityIds("budget"),
    pendingEntityIds("settings"),
  ]);

  const accounts = data.accounts.filter((row) => !pendingAccounts.has(row.id));
  const categories = data.categories.filter(
    (row) => !pendingCategories.has(row.id),
  );
  const importBatches = data.importBatches.filter(
    (row) => !pendingBatches.has(row.id),
  );
  const transactions = data.transactions.filter(
    (row) => !pendingTxns.has(row.id),
  );
  const budgets = data.budgets.filter((row) => !pendingBudgets.has(row.id));

  await db.transaction(
    "rw",
    [db.accounts, db.categories, db.importBatches, db.transactions, db.budgets],
    async () => {
      if (accounts.length) await db.accounts.bulkPut(accounts);
      if (categories.length) await db.categories.bulkPut(categories);
      if (importBatches.length) await db.importBatches.bulkPut(importBatches);
      if (transactions.length) await db.transactions.bulkPut(transactions);
      if (budgets.length) await db.budgets.bulkPut(budgets);
    },
  );

  if (data.settings && pendingSettings.size === 0) {
    await saveDeviceSettings({
      defaultAccountId: data.settings.defaultAccountId,
      periodStartDay: data.settings.periodStartDay,
    });
  }

  await setMeta(CURSOR_KEY, data.cursor);

  return {
    count:
      accounts.length +
      categories.length +
      importBatches.length +
      transactions.length +
      budgets.length,
    full: data.hasMore,
  };
}

/** 连续拉取直到没有满页（大账号首次同步可能超过一页） */
async function pullAll(): Promise<number> {
  let total = 0;
  for (let round = 0; round < MAX_PULL_ROUNDS; round += 1) {
    const page = await pullOnce();
    total += page.count;
    if (!page.full) break;
  }
  return total;
}

/** 首次登录：把本机已有数据（含预设账户与分类）并入账号 */
async function enqueueLocalData(): Promise<void> {
  const db = await getDb();
  const [accounts, categories, importBatches, transactions, budgets] =
    await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.importBatches.toArray(),
      db.transactions.toArray(),
      db.budgets.toArray(),
    ]);

  await enqueueChanges([
    ...accounts.map((row) => ({
      entity: "account" as const,
      entityId: row.id,
    })),
    ...categories.map((row) => ({
      entity: "category" as const,
      entityId: row.id,
    })),
    ...importBatches.map((row) => ({
      entity: "import_batch" as const,
      entityId: row.id,
    })),
    ...transactions.map((row) => ({
      entity: "transaction" as const,
      entityId: row.id,
    })),
    ...budgets.map((row) => ({ entity: "budget" as const, entityId: row.id })),
    { entity: "settings" as const, entityId: "app" },
  ]);

  await setMeta(BOOTSTRAP_KEY, "1");
}

async function runSync(): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    pushed: 0,
    pulled: 0,
    rejected: 0,
    at: new Date().toISOString(),
  };

  if (!(await hasSession())) return outcome;

  const firstRun = (await getMeta(BOOTSTRAP_KEY)) === null;
  outcome.pulled += await pullAll();

  if (firstRun) {
    const db = await getDb();
    const hasPending = (await db.outbox.count()) > 0;
    if (!hasPending && outcome.pulled === 0) {
      await enqueueLocalData();
    } else {
      await setMeta(BOOTSTRAP_KEY, "1");
    }
  }

  for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
    const pushed = await pushOnce();
    if (!pushed) break;
    outcome.pushed += pushed.count;
    outcome.rejected += pushed.rejected;
    if (pushed.count < PUSH_BATCH) break;
  }

  if (outcome.pushed > 0) {
    // 拉回服务端时间戳，保证下次增量拉取不会重复覆盖
    outcome.pulled += await pullAll();
  }

  return outcome;
}

/** 立即同步一次；并发调用共享同一个进行中的任务 */
export function syncNow(): Promise<SyncOutcome> {
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
  }
  return running;
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return db.outbox.count();
}
