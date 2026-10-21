"use client";

import { apiFetch } from "@/lib/api/client";
import { authClient } from "@/lib/auth/client";
import {
  bumpOutboxAttempts,
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
/** 同一条变更被服务端拒绝的最大次数，超过才丢弃（否则一条坏数据永远卡在队列里） */
const MAX_ATTEMPTS = 5;

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

export interface SyncRejection {
  entity: string;
  id: string;
  reason: string;
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  rejected: number;
  /** 重试到上限后被放弃的变更数 */
  dropped: number;
  /** 被服务端拒绝的原因（最多保留 5 条，用于界面提示） */
  rejections: SyncRejection[];
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

interface PushAttempt {
  /** 本次提交的变更条数（已按实体去重前的队列条数） */
  count: number;
  /** 服务端明确拒绝、留在队列里等待重试的条数 */
  retained: number;
  /** 重试到上限后被放弃的条数 */
  dropped: number;
  rejections: SyncRejection[];
}

async function pushOnce(): Promise<PushAttempt | null> {
  const items = await takeOutbox(PUSH_BATCH);
  if (items.length === 0) return null;

  const db = await getDb();
  // 同一实体的多次修改合并成一条（以最新一次为准），并记住每条变更对应的队列序号，
  // 这样服务端只接收了一部分时，可以精确地只删除已成功的那部分。
  const latest = new Map<string, OutboxItem>();
  const seqsByKey = new Map<string, number[]>();
  for (const item of items) {
    const key = `${item.entity}:${item.entityId}`;
    latest.set(key, item);
    const seqs = seqsByKey.get(key) ?? [];
    if (typeof item.seq === "number") seqs.push(item.seq);
    seqsByKey.set(key, seqs);
  }

  const payload: Record<string, unknown> = {};
  const sent = new Set<string>();
  for (const [key, item] of latest) {
    if (item.entity === "settings") {
      const row = await db.deviceSettings.get("app");
      payload.settings = row
        ? {
            defaultAccountId: row.defaultAccountId,
            periodStartDay: row.periodStartDay,
            updatedAt: new Date().toISOString(),
          }
        : null;
      sent.add(key);
      continue;
    }
    const row = await loadRow(item.entity, item.entityId);
    if (!row) continue; // 本机已物理删除，无需上传
    const payloadKey = PAYLOAD_KEY[item.entity];
    const list = (payload[payloadKey] as unknown[] | undefined) ?? [];
    list.push(row);
    payload[payloadKey] = list;
    sent.add(key);
  }

  // 队列里的行在本机都已不存在：直接出队，不必发请求
  if (sent.size === 0) {
    await dropOutbox(
      items.flatMap(
        (item) => seqsByKey.get(`${item.entity}:${item.entityId}`) ?? [],
      ),
    );
    return { count: items.length, retained: 0, dropped: 0, rejections: [] };
  }

  const result = await apiFetch<PushResponse>("/api/v1/sync/push", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const applied = new Map<string, Set<string>>();
  for (const [entity, ids] of Object.entries(result.applied ?? {})) {
    applied.set(entity, new Set(ids));
  }
  const settingsApplied = (result.applied?.settings ?? []).length > 0;

  const dropSeqs: number[] = [];
  const retry: Array<{ seq: number; attempts: number }> = [];
  const rejections: SyncRejection[] = [];
  let dropped = 0;

  for (const [key, item] of latest) {
    const seqs = seqsByKey.get(key) ?? [];
    // 本机没有这一行（上面已跳过）→ 无需保留
    if (!sent.has(key)) {
      dropSeqs.push(...seqs);
      continue;
    }
    const ok =
      item.entity === "settings"
        ? settingsApplied
        : (applied.get(PAYLOAD_KEY[item.entity])?.has(item.entityId) ?? false);
    if (ok) {
      dropSeqs.push(...seqs);
      continue;
    }

    const attempts = (item.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // 重试到上限：丢弃，但把原因交给界面显示，不再静默丢失
      dropSeqs.push(...seqs);
      dropped += 1;
    } else {
      retry.push(...seqs.map((seq) => ({ seq, attempts })));
    }
  }

  const rejectionById = new Map(
    result.rejected.map((row) => [`${row.entity}:${row.id}`, row]),
  );
  for (const item of latest.values()) {
    const hit = rejectionById.get(
      `${PAYLOAD_KEY[item.entity]}:${item.entityId}`,
    );
    if (hit)
      rejections.push({ entity: hit.entity, id: hit.id, reason: hit.reason });
  }
  // 服务端没给原因（例如整批 200 被网关改写）时，也要让人知道有东西没上去
  if (rejections.length === 0 && dropped + retry.length > 0) {
    rejections.push({
      entity: "unknown",
      id: "-",
      reason: "服务端未确认接收，稍后自动重试",
    });
  }

  await dropOutbox(dropSeqs);
  await bumpOutboxAttempts(retry);

  if (rejections.length > 0) {
    console.warn("[sync] 部分变更未被服务端接收", rejections);
  }
  return {
    count: items.length,
    retained: retry.length,
    dropped,
    rejections,
  };
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
    dropped: 0,
    rejections: [],
    at: new Date().toISOString(),
  };

  if (!(await hasSession())) return outcome;

  const firstRun = (await getMeta(BOOTSTRAP_KEY)) === null;
  outcome.pulled += await pullAll();

  if (firstRun) {
    // 云端为空 → 把本机整库（含预设账户、分类和历史记录）一次性推上去。
    // 这里不能再看 outbox 是否为空：登录前只要记过一笔账，队列就非空，
    // 旧逻辑会因此跳过整库上传，导致账户/分类永远留在本机。
    if (outcome.pulled === 0) {
      await enqueueLocalData();
    } else {
      // 云端已有数据（换设备登录）：只推本机队列里的变更，避免把本机预设灌进已有账号
      await setMeta(BOOTSTRAP_KEY, "1");
    }
  }

  for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
    const attempt = await pushOnce();
    if (!attempt) break;
    outcome.pushed += attempt.count;
    outcome.rejected += attempt.rejections.length;
    outcome.dropped += attempt.dropped;
    outcome.rejections.push(...attempt.rejections);
    // 有变更被留在队列里等待重试时立刻收手，否则会拿着同一批数据空转
    if (attempt.count < PUSH_BATCH || attempt.retained > 0) break;
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

/**
 * 把本机全部数据重新排队上传一次。
 * 用途：云端数据缺失（早期版本漏传整库）或从备份恢复后，需要主动覆盖云端。
 */
export async function resyncAll(): Promise<SyncOutcome> {
  await enqueueLocalData();
  await setMeta(BOOTSTRAP_KEY, "1");
  return syncNow();
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return db.outbox.count();
}
