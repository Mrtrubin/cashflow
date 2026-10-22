import { nowIso, todayISO } from "@/lib/date";
import {
  type DeviceSettingsRow,
  enqueueChange,
  enqueueChanges,
  getDb,
  getDeviceSettings,
  saveDeviceSettings as saveDeviceSettingsRow,
} from "@/lib/db";
import { presetAccounts, presetCategories } from "@/lib/presets";
import {
  type Account,
  type Budget,
  type Category,
  type DeviceSettings,
  type ImportBatch,
  type Transaction,
  TX_KIND_LABELS,
  type TxKind,
} from "@/lib/types";

// 常用设备设置入口（页面从 repo 导入）
export { getDeviceSettings };

/** 账号设置（默认账户 / 账期起始日）改动需要同步，设备设置（主题等）留在本机 */
export async function saveDeviceSettings(
  patch: Partial<DeviceSettings>,
): Promise<void> {
  await saveDeviceSettingsRow(patch);
  if ("defaultAccountId" in patch || "periodStartDay" in patch) {
    await enqueueChange("settings", "app");
  }
}

export const SCHEMA_VERSION = 1;

function uid(): string {
  return crypto.randomUUID();
}

// ---------- 查询 ----------

export async function listAccounts(
  includeArchived = false,
): Promise<Account[]> {
  const db = await getDb();
  const all = await db.accounts.orderBy("sortOrder").toArray();
  return all.filter((a) => !a.deletedAt && (includeArchived || !a.archived));
}

export async function listAllAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.accounts.orderBy("sortOrder").toArray();
}

export async function listCategories(
  includeArchived = false,
): Promise<Category[]> {
  const db = await getDb();
  const all = await db.categories.toArray();
  return all
    .filter((c) => !c.deletedAt && (includeArchived || !c.archived))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function listAllCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.categories.toArray();
}

export async function listTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  return db.transactions.orderBy("occurredOn").reverse().toArray();
}

export async function getTransaction(
  id: string,
): Promise<Transaction | undefined> {
  const db = await getDb();
  return db.transactions.get(id);
}

export async function listRecentTransactions(
  limit: number,
): Promise<Transaction[]> {
  const db = await getDb();
  const all = await db.transactions.orderBy("createdAt").reverse().toArray();
  return all.filter((t) => !t.deletedAt).slice(0, limit);
}

export async function listImportBatches(): Promise<ImportBatch[]> {
  const db = await getDb();
  return db.importBatches.orderBy("createdAt").reverse().toArray();
}

export async function getDefaultAccountId(): Promise<string | null> {
  const db = await getDb();
  const row = await db.deviceSettings.get("app");
  return row?.defaultAccountId ?? null;
}

// ---------- 记录（REC） ----------

export interface TxnInput {
  kind: TxKind;
  amount: number;
  occurredOn: string;
  occurredAt: string | null;
  categoryId: string | null;
  accountId: string;
  toAccountId: string | null;
  payee: string | null;
  note: string | null;
  tags: string[];
}

export async function createTransaction(input: TxnInput): Promise<Transaction> {
  const db = await getDb();
  const ts = nowIso();
  const txn: Transaction = {
    id: uid(),
    ...input,
    importBatchId: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  await db.transactions.add(txn);
  await enqueueChange("transaction", txn.id);
  return txn;
}

export async function updateTransaction(
  id: string,
  patch: TxnInput,
): Promise<void> {
  const db = await getDb();
  await db.transactions.update(id, { ...patch, updatedAt: nowIso() });
  await enqueueChange("transaction", id);
}

/** 删除为软删除（可撤销） */
export async function softDeleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.transactions.update(id, {
    deletedAt: nowIso(),
    updatedAt: nowIso(),
  });
  await enqueueChange("transaction", id);
}

/** 撤销删除：恢复软删除的记录 */
export async function restoreTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.transactions.update(id, { deletedAt: null, updatedAt: nowIso() });
  await enqueueChange("transaction", id);
}

/** 备注记忆（REC-05）：命中历史备注/商户时返回最近一次使用的类型与分类 */
export async function findLastUsage(
  text: string,
): Promise<{ kind: TxKind; categoryId: string | null } | null> {
  const db = await getDb();
  const target = text.trim();
  if (!target) return null;
  const all = await db.transactions.orderBy("createdAt").reverse().toArray();
  const hit = all.find(
    (t) =>
      !t.deletedAt &&
      (t.note === target || t.payee === target) &&
      t.kind !== "transfer",
  );
  return hit ? { kind: hit.kind, categoryId: hit.categoryId } : null;
}

// ---------- 账户（ACC） ----------

export interface AccountInput {
  name: string;
  type: Account["type"];
  openingBalance: number;
  archived: boolean;
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const db = await getDb();
  const count = await db.accounts.count();
  const ts = nowIso();
  const account: Account = {
    id: uid(),
    ...input,
    currency: "CNY",
    sortOrder: count,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  await db.accounts.add(account);
  await enqueueChange("account", account.id);
  return account;
}

export async function updateAccount(
  id: string,
  patch: Partial<AccountInput>,
): Promise<void> {
  const db = await getDb();
  await db.accounts.update(id, { ...patch, updatedAt: nowIso() });
  await enqueueChange("account", id);
}

// ---------- 分类（CAT） ----------

export interface CategoryInput {
  name: string;
  kind: Category["kind"];
  parentId: string | null;
  icon: string;
  color: string;
  archived: boolean;
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  const db = await getDb();
  const siblings = await db.categories
    .where("parentId")
    .equals(input.parentId ?? "")
    .count();
  const ts = nowIso();
  const category: Category = {
    id: uid(),
    ...input,
    sortOrder: siblings,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  await db.categories.add(category);
  await enqueueChange("category", category.id);
  return category;
}

export async function updateCategory(
  id: string,
  patch: Partial<CategoryInput>,
): Promise<void> {
  const db = await getDb();
  await db.categories.update(id, { ...patch, updatedAt: nowIso() });
  await enqueueChange("category", id);
}

// ---------- 导入（IMP） ----------

export interface ImportRowPlan {
  row: ParsedRowLike;
  categoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  keep: boolean;
}

// 避免 repo 依赖解析器内部类型，用结构化子集
interface ParsedRowLike {
  lineNo: number;
  status: "ok" | "confirm" | "error";
  date: string | null;
  time: string | null;
  kind: TxKind | null;
  amountCents: number | null;
  note: string | null;
  tags: string[];
}

export interface ImportResult {
  batchId: string;
  imported: number;
  skipped: number;
  failed: number;
}

/** 执行导入：记录批次，写入记录（导入结果与预览一致） */
export async function runImport(
  source: ImportBatch["source"],
  plans: ImportRowPlan[],
): Promise<ImportResult> {
  const db = await getDb();
  const batchId = uid();
  const ts = nowIso();

  const toImport = plans.filter(
    (plan) => plan.keep && plan.row.status !== "error",
  );
  const skipped = plans.filter(
    (plan) => !plan.keep && plan.row.status !== "error",
  ).length;
  const failed = plans.filter((plan) => plan.row.status === "error").length;

  const txns: Transaction[] = toImport
    .filter(
      (plan) =>
        plan.row.date &&
        plan.row.kind &&
        plan.row.amountCents &&
        plan.accountId,
    )
    .map((plan) => ({
      id: uid(),
      kind: plan.row.kind as TxKind,
      amount: plan.row.amountCents as number,
      occurredOn: plan.row.date as string,
      occurredAt: plan.row.time,
      categoryId: plan.categoryId,
      accountId: plan.accountId as string,
      toAccountId: plan.toAccountId,
      payee: null,
      note: plan.row.note,
      tags: plan.row.tags,
      importBatchId: batchId,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    }));

  const batch: ImportBatch = {
    id: batchId,
    source,
    total: plans.length,
    imported: txns.length,
    skipped,
    failed,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };

  await db.transaction("rw", db.importBatches, db.transactions, async () => {
    await db.importBatches.add(batch);
    await db.transactions.bulkAdd(txns);
  });

  await enqueueChanges([
    { entity: "import_batch", entityId: batchId },
    ...txns.map((txn) => ({
      entity: "transaction" as const,
      entityId: txn.id,
    })),
  ]);

  return { batchId, imported: txns.length, skipped, failed };
}

/** 撤销整个批次：批量软删除该批次的记录 */
export async function undoImportBatch(batchId: string): Promise<number> {
  const db = await getDb();
  const ts = nowIso();
  let count = 0;
  await db.transaction("rw", db.transactions, db.importBatches, async () => {
    const txns = await db.transactions
      .where("importBatchId")
      .equals(batchId)
      .toArray();
    const active = txns.filter((t) => !t.deletedAt);
    count = active.length;
    await Promise.all(
      active.map((t) =>
        db.transactions.update(t.id, { deletedAt: ts, updatedAt: ts }),
      ),
    );
    await db.importBatches.update(batchId, { deletedAt: ts, updatedAt: ts });
  });
  await enqueueChanges([
    { entity: "import_batch", entityId: batchId },
    ...(
      await db.transactions.where("importBatchId").equals(batchId).toArray()
    ).map((txn) => ({
      entity: "transaction" as const,
      entityId: txn.id,
    })),
  ]);
  return count;
}

// ---------- 数据管理（DAT） ----------

export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  importBatches: ImportBatch[];
  deviceSettings: Omit<DeviceSettings, "lastExportAt"> | null;
}

export async function exportBackup(): Promise<BackupFile> {
  const db = await getDb();
  const [
    accounts,
    categories,
    transactions,
    budgets,
    importBatches,
    settingsRow,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.importBatches.toArray(),
    db.deviceSettings.get("app"),
  ]);
  const {
    key: _key,
    lastExportAt: _lastExportAt,
    ...settings
  } = settingsRow ?? ({} as DeviceSettingsRow);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    accounts,
    categories,
    transactions,
    budgets,
    importBatches,
    deviceSettings: settingsRow ? settings : null,
  };
}

/** 从 JSON 恢复：覆盖当前数据（调用前需二次确认） */
export async function restoreBackup(file: BackupFile): Promise<void> {
  if (!file || file.schemaVersion === undefined) {
    throw new Error("备份文件格式不正确");
  }
  const db = await getDb();
  await db.transaction(
    "rw",
    [
      db.accounts,
      db.categories,
      db.transactions,
      db.budgets,
      db.importBatches,
      db.deviceSettings,
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.categories.clear(),
        db.transactions.clear(),
        db.budgets.clear(),
        db.importBatches.clear(),
      ]);
      await db.accounts.bulkAdd(file.accounts ?? []);
      await db.categories.bulkAdd(file.categories ?? []);
      await db.transactions.bulkAdd(file.transactions ?? []);
      await db.budgets.bulkAdd(file.budgets ?? []);
      await db.importBatches.bulkAdd(file.importBatches ?? []);
      if (file.deviceSettings) {
        await db.deviceSettings.put({
          key: "app",
          ...file.deviceSettings,
          lastExportAt: null,
        });
      }
    },
  );

  // 恢复后整库需要重新上传（登录状态下）
  await enqueueChanges([
    ...(file.accounts ?? []).map((row) => ({
      entity: "account" as const,
      entityId: row.id,
    })),
    ...(file.categories ?? []).map((row) => ({
      entity: "category" as const,
      entityId: row.id,
    })),
    ...(file.importBatches ?? []).map((row) => ({
      entity: "import_batch" as const,
      entityId: row.id,
    })),
    ...(file.transactions ?? []).map((row) => ({
      entity: "transaction" as const,
      entityId: row.id,
    })),
    ...(file.budgets ?? []).map((row) => ({
      entity: "budget" as const,
      entityId: row.id,
    })),
  ]);
}

export async function markExported(): Promise<void> {
  const db = await getDb();
  await db.deviceSettings.update("app", { lastExportAt: nowIso() });
}

export interface CsvRow {
  date: string;
  kind: TxKind;
  amountCents: number;
  categoryName: string;
  accountName: string;
  toAccountName: string;
  note: string;
  tags: string[];
}

export function toCsv(rows: CsvRow[]): string {
  const header = "日期,类型,金额,分类,账户,转入账户,备注,标签";
  const escapeCsv = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = rows.map((row) =>
    [
      row.date,
      TX_KIND_LABELS[row.kind],
      (row.amountCents / 100).toFixed(2),
      row.categoryName,
      row.accountName,
      row.toAccountName,
      row.note,
      row.tags.map((tag) => `#${tag}`).join(" "),
    ]
      .map((cell) => escapeCsv(String(cell ?? "")))
      .join(","),
  );
  // BOM 便于 Excel 识别 UTF-8
  return `\uFEFF${[header, ...lines].join("\n")}`;
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const ts = nowIso();

  // 清空 = 批量软删除（硬删除无法同步到其他设备），再重新播种预设账户与分类
  const [accounts, categories, transactions, budgets, importBatches] =
    await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.transactions.toArray(),
      db.budgets.toArray(),
      db.importBatches.toArray(),
    ]);

  const stamp = <T extends { deletedAt: string | null; updatedAt: string }>(
    rows: T[],
  ) =>
    rows.map((row) => ({
      ...row,
      deletedAt: row.deletedAt ?? ts,
      updatedAt: ts,
    }));

  await db.transaction(
    "rw",
    [db.accounts, db.categories, db.transactions, db.budgets, db.importBatches],
    async () => {
      await db.accounts.bulkPut(stamp(accounts));
      await db.categories.bulkPut(stamp(categories));
      await db.transactions.bulkPut(stamp(transactions));
      await db.budgets.bulkPut(stamp(budgets));
      await db.importBatches.bulkPut(stamp(importBatches));
    },
  );

  const seededAccounts = presetAccounts();
  const seededCategories = presetCategories();
  await db.accounts.bulkAdd(seededAccounts);
  await db.categories.bulkAdd(seededCategories);

  await enqueueChanges([
    ...accounts.map((row) => ({
      entity: "account" as const,
      entityId: row.id,
    })),
    ...categories.map((row) => ({
      entity: "category" as const,
      entityId: row.id,
    })),
    ...transactions.map((row) => ({
      entity: "transaction" as const,
      entityId: row.id,
    })),
    ...budgets.map((row) => ({
      entity: "budget" as const,
      entityId: row.id,
    })),
    ...importBatches.map((row) => ({
      entity: "import_batch" as const,
      entityId: row.id,
    })),
    ...seededAccounts.map((row) => ({
      entity: "account" as const,
      entityId: row.id,
    })),
    ...seededCategories.map((row) => ({
      entity: "category" as const,
      entityId: row.id,
    })),
  ]);

  await saveDeviceSettingsRow({ defaultAccountId: null });
  await enqueueChange("settings", "app");
}

export function downloadFile(
  filename: string,
  content: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function backupFilename(): string {
  return `cashflow-backup-${todayISO()}.json`;
}
