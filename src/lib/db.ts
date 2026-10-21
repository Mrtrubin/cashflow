"use client";

import Dexie, { type EntityTable } from "dexie";
import {
  DEFAULT_ACCOUNT_NAME,
  presetAccounts,
  presetCategories,
} from "@/lib/presets";
import type {
  Account,
  Budget,
  Category,
  DeviceSettings,
  ImportBatch,
  Transaction,
} from "@/lib/types";

// 同步队列：本机尚未上传到云端的变更（本机版先建表，云同步阶段使用）
export interface OutboxItem {
  seq?: number;
  entity:
    | "account"
    | "category"
    | "transaction"
    | "budget"
    | "import_batch"
    | "settings";
  entityId: string;
  op: "upsert" | "delete";
  queuedAt: string;
  /** 服务端拒绝后的重试次数；达到上限才丢弃，避免一条坏数据卡住整条队列 */
  attempts?: number;
}

export interface MetaRow {
  key: string;
  value: string;
}

export type DeviceSettingsRow = DeviceSettings & { key: "app" };

const DEFAULT_DEVICE_SETTINGS: DeviceSettingsRow = {
  key: "app",
  defaultAccountId: null,
  periodStartDay: 1,
  theme: "system",
  lastExportAt: null,
};

export class CashflowDatabase extends Dexie {
  accounts!: EntityTable<Account, "id">;
  categories!: EntityTable<Category, "id">;
  transactions!: EntityTable<Transaction, "id">;
  budgets!: EntityTable<Budget, "id">;
  importBatches!: EntityTable<ImportBatch, "id">;
  outbox!: EntityTable<OutboxItem, "seq">;
  meta!: EntityTable<MetaRow, "key">;
  deviceSettings!: EntityTable<DeviceSettingsRow, "key">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      accounts: "id, archived, sortOrder",
      categories: "id, kind, parentId, archived, [kind+parentId]",
      transactions:
        "id, occurredOn, kind, accountId, toAccountId, categoryId, importBatchId, [kind+occurredOn]",
      budgets: "id, categoryId",
      importBatches: "id, createdAt",
      outbox: "++seq, entity, entityId",
      meta: "key",
      deviceSettings: "key",
    });
    // v1 漏了 transactions.createdAt 索引，而 listRecentTransactions /
    // findLastUsage 都按创建时间倒序取数，Dexie 会直接抛
    // SchemaError: KeyPath createdAt on object store transactions is not indexed。
    // 未在此列出的表沿用 v1 的定义；改动 transactions 必须写全它的索引列表。
    this.version(2).stores({
      transactions:
        "id, occurredOn, kind, accountId, toAccountId, categoryId, importBatchId, createdAt, [kind+occurredOn]",
    });
  }
}

// 本机模式使用独立数据库；登录后按账号分库（cashflow-u-<userId>），见 AUTH-06
const LOCAL_DB_NAME = "cashflow-local";

let dbPromise: Promise<CashflowDatabase> | null = null;

/** 打开（并首次播种）当前数据库 */
export function getDb(): Promise<CashflowDatabase> {
  if (!dbPromise) {
    dbPromise = openAndSeed();
  }
  return dbPromise;
}

async function openAndSeed(): Promise<CashflowDatabase> {
  const db = new CashflowDatabase(LOCAL_DB_NAME);
  await db.open();
  await seedIfEmpty(db);
  return db;
}

async function seedIfEmpty(db: CashflowDatabase): Promise<void> {
  await db.transaction(
    "rw",
    db.accounts,
    db.categories,
    db.deviceSettings,
    async () => {
      const [accountCount, categoryCount] = await Promise.all([
        db.accounts.count(),
        db.categories.count(),
      ]);
      if (accountCount === 0) {
        const accounts = presetAccounts();
        await db.accounts.bulkAdd(accounts);
        const defaultAccount = accounts.find(
          (a) => a.name === DEFAULT_ACCOUNT_NAME,
        );
        await db.deviceSettings.put({
          ...DEFAULT_DEVICE_SETTINGS,
          defaultAccountId: defaultAccount?.id ?? null,
        });
      }
      if (categoryCount === 0) {
        await db.categories.bulkAdd(presetCategories());
      }
    },
  );
}

export async function getDeviceSettings(): Promise<DeviceSettings> {
  const db = await getDb();
  const row = await db.deviceSettings.get("app");
  if (!row) return { ...DEFAULT_DEVICE_SETTINGS };
  const { key: _key, ...settings } = row;
  return settings;
}

export async function saveDeviceSettings(
  patch: Partial<DeviceSettings>,
): Promise<void> {
  const db = await getDb();
  const current = await getDeviceSettings();
  await db.deviceSettings.put({ key: "app", ...current, ...patch });
}

// ---------- 同步队列 ----------

/** 记录一次本机变更；同一实体的多条变更在推送时按最新一条合并 */
export async function enqueueChange(
  entity: OutboxItem["entity"],
  entityId: string,
  op: OutboxItem["op"] = "upsert",
): Promise<void> {
  const db = await getDb();
  await db.outbox.add({
    entity,
    entityId,
    op,
    queuedAt: new Date().toISOString(),
  });
}

export async function enqueueChanges(
  items: Array<{
    entity: OutboxItem["entity"];
    entityId: string;
    op?: OutboxItem["op"];
  }>,
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const queuedAt = new Date().toISOString();
  await db.outbox.bulkAdd(
    items.map((item) => ({
      entity: item.entity,
      entityId: item.entityId,
      op: item.op ?? "upsert",
      queuedAt,
    })),
  );
}

/** 读取一批待推送变更（按入队顺序） */
export async function takeOutbox(limit: number): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.outbox.orderBy("seq").limit(limit).toArray();
}

export async function dropOutbox(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  const db = await getDb();
  await db.outbox.bulkDelete(seqs);
}

/** 服务端拒绝后给队列项累计重试次数（不改变表结构，attempts 只是普通字段） */
export async function bumpOutboxAttempts(
  items: Array<{ seq: number; attempts: number }>,
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  await db.outbox.bulkUpdate(
    items.map((item) => ({
      key: item.seq,
      changes: { attempts: item.attempts },
    })),
  );
}

export async function pendingEntityIds(
  entity: OutboxItem["entity"],
): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.outbox.where("entity").equals(entity).toArray();
  return new Set(rows.map((row) => row.entityId));
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.meta.put({ key, value });
}
