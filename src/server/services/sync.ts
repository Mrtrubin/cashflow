import "server-only";

import type { PoolClient } from "pg";
import { withTransaction } from "@/server/db";
import { ownedIds } from "@/server/repositories";
import type {
  AccountRow,
  BudgetRow,
  CategoryRow,
  ImportBatchRow,
  PushPayload,
  TransactionRow,
  UserSettingsRow,
} from "@/server/validation";

// 推送（本机 → 云端）的业务规则：
//   * 依赖顺序：账户 → 分类 → 导入批次 → 记录 → 预算 → 账号设置
//   * 每行独立 savepoint：单行失败（外键、约束、越权）不影响同批其他行
//   * 冲突按「最后到达服务器的版本生效」；软删除不可被复活（数据库触发器兜底）
//   * 外键归属校验：只能引用自己账号下的账户 / 分类 / 批次

export interface RejectedRow {
  entity: keyof PushPayload;
  id: string;
  reason: string;
}

export interface PushResult {
  applied: Record<string, string[]>;
  rejected: RejectedRow[];
}

// 每次调用都要新建数组：共享引用会让并发请求互相污染
function emptyApplied(): Record<string, string[]> {
  return {
    accounts: [],
    categories: [],
    importBatches: [],
    transactions: [],
    budgets: [],
    settings: [],
  };
}

async function runRow(
  client: PoolClient,
  sql: string,
  params: unknown[],
): Promise<boolean> {
  await client.query("savepoint row");
  try {
    const result = await client.query(sql, params);
    await client.query("release savepoint row");
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query("rollback to savepoint row");
    throw error;
  }
}

// 把 Postgres 错误翻译成用户能看懂的说明，避免把整行数据回给客户端
function errorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "23503":
      return "引用的账户、分类或批次不存在";
    case "23514":
      return "数据不满足约束（如转账必须指定转入账户）";
    case "23505":
      return "记录已存在";
    case "22P02":
    case "22007":
    case "22008":
      return "字段格式不正确";
    default:
      return error instanceof Error ? error.message : "写入失败";
  }
}

async function applyAccounts(
  client: PoolClient,
  userId: string,
  rows: AccountRow[],
  result: PushResult,
): Promise<void> {
  for (const row of rows) {
    try {
      const ok = await runRow(
        client,
        `insert into accounts
           (id, user_id, name, type, currency, opening_balance, archived, sort_order, deleted_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           name = excluded.name,
           type = excluded.type,
           currency = excluded.currency,
           opening_balance = excluded.opening_balance,
           archived = excluded.archived,
           sort_order = excluded.sort_order,
           deleted_at = excluded.deleted_at
         where accounts.user_id = excluded.user_id
         returning id`,
        [
          row.id,
          userId,
          row.name,
          row.type,
          row.currency,
          row.openingBalance,
          row.archived,
          row.sortOrder,
          row.deletedAt,
        ],
      );
      if (ok) result.applied.accounts.push(row.id);
      else
        result.rejected.push({
          entity: "accounts",
          id: row.id,
          reason: "该记录属于其他账号",
        });
    } catch (error) {
      result.rejected.push({
        entity: "accounts",
        id: row.id,
        reason: errorMessage(error),
      });
    }
  }
}

async function applyCategories(
  client: PoolClient,
  userId: string,
  rows: CategoryRow[],
  result: PushResult,
): Promise<void> {
  // 一级分类先写，子分类后写，避免同批内父分类尚未落库
  const ordered = [...rows].sort(
    (a, b) => Number(a.parentId !== null) - Number(b.parentId !== null),
  );
  for (const row of ordered) {
    try {
      const ok = await runRow(
        client,
        `insert into categories
           (id, user_id, name, kind, parent_id, icon, color, archived, sort_order, deleted_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do update set
           name = excluded.name,
           kind = excluded.kind,
           parent_id = excluded.parent_id,
           icon = excluded.icon,
           color = excluded.color,
           archived = excluded.archived,
           sort_order = excluded.sort_order,
           deleted_at = excluded.deleted_at
         where categories.user_id = excluded.user_id
         returning id`,
        [
          row.id,
          userId,
          row.name,
          row.kind,
          row.parentId,
          row.icon,
          row.color,
          row.archived,
          row.sortOrder,
          row.deletedAt,
        ],
      );
      if (ok) result.applied.categories.push(row.id);
      else
        result.rejected.push({
          entity: "categories",
          id: row.id,
          reason: "该记录属于其他账号",
        });
    } catch (error) {
      result.rejected.push({
        entity: "categories",
        id: row.id,
        reason: errorMessage(error),
      });
    }
  }
}

async function applyImportBatches(
  client: PoolClient,
  userId: string,
  rows: ImportBatchRow[],
  result: PushResult,
): Promise<void> {
  for (const row of rows) {
    try {
      const ok = await runRow(
        client,
        `insert into import_batches
           (id, user_id, source, total, imported, skipped, failed, deleted_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           source = excluded.source,
           total = excluded.total,
           imported = excluded.imported,
           skipped = excluded.skipped,
           failed = excluded.failed,
           deleted_at = excluded.deleted_at
         where import_batches.user_id = excluded.user_id
         returning id`,
        [
          row.id,
          userId,
          row.source,
          row.total,
          row.imported,
          row.skipped,
          row.failed,
          row.deletedAt,
        ],
      );
      if (ok) result.applied.importBatches.push(row.id);
      else
        result.rejected.push({
          entity: "importBatches",
          id: row.id,
          reason: "该记录属于其他账号",
        });
    } catch (error) {
      result.rejected.push({
        entity: "importBatches",
        id: row.id,
        reason: errorMessage(error),
      });
    }
  }
}

async function applyTransactions(
  client: PoolClient,
  userId: string,
  rows: TransactionRow[],
  result: PushResult,
): Promise<void> {
  const accountIds = new Set<string>();
  const categoryIds = new Set<string>();
  const batchIds = new Set<string>();
  for (const row of rows) {
    accountIds.add(row.accountId);
    if (row.toAccountId) accountIds.add(row.toAccountId);
    if (row.categoryId) categoryIds.add(row.categoryId);
    if (row.importBatchId) batchIds.add(row.importBatchId);
  }

  const [ownedAccounts, ownedCategories, ownedBatches] = await Promise.all([
    ownedIds(client, "accounts", userId, [...accountIds]),
    ownedIds(client, "categories", userId, [...categoryIds]),
    ownedIds(client, "import_batches", userId, [...batchIds]),
  ]);

  for (const row of rows) {
    const missing = !ownedAccounts.has(row.accountId)
      ? "账户不存在"
      : row.toAccountId && !ownedAccounts.has(row.toAccountId)
        ? "转入账户不存在"
        : row.categoryId && !ownedCategories.has(row.categoryId)
          ? "分类不存在"
          : row.importBatchId && !ownedBatches.has(row.importBatchId)
            ? "导入批次不存在"
            : null;
    if (missing) {
      result.rejected.push({
        entity: "transactions",
        id: row.id,
        reason: missing,
      });
      continue;
    }

    try {
      const ok = await runRow(
        client,
        `insert into transactions
           (id, user_id, kind, amount, occurred_on, occurred_time, category_id, account_id,
            to_account_id, payee, note, tags, import_batch_id, deleted_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set
           kind = excluded.kind,
           amount = excluded.amount,
           occurred_on = excluded.occurred_on,
           occurred_time = excluded.occurred_time,
           category_id = excluded.category_id,
           account_id = excluded.account_id,
           to_account_id = excluded.to_account_id,
           payee = excluded.payee,
           note = excluded.note,
           tags = excluded.tags,
           import_batch_id = excluded.import_batch_id,
           deleted_at = excluded.deleted_at
         where transactions.user_id = excluded.user_id
         returning id`,
        [
          row.id,
          userId,
          row.kind,
          row.amount,
          row.occurredOn,
          row.occurredAt,
          row.categoryId,
          row.accountId,
          row.toAccountId,
          row.payee ?? null,
          row.note ?? null,
          row.tags,
          row.importBatchId,
          row.deletedAt,
        ],
      );
      if (ok) result.applied.transactions.push(row.id);
      else
        result.rejected.push({
          entity: "transactions",
          id: row.id,
          reason: "该记录属于其他账号",
        });
    } catch (error) {
      result.rejected.push({
        entity: "transactions",
        id: row.id,
        reason: errorMessage(error),
      });
    }
  }
}

async function applyBudgets(
  client: PoolClient,
  userId: string,
  rows: BudgetRow[],
  result: PushResult,
): Promise<void> {
  const categoryIds = rows
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);
  const ownedCategories = await ownedIds(
    client,
    "categories",
    userId,
    categoryIds,
  );

  for (const row of rows) {
    if (row.categoryId && !ownedCategories.has(row.categoryId)) {
      result.rejected.push({
        entity: "budgets",
        id: row.id,
        reason: "分类不存在",
      });
      continue;
    }
    try {
      const ok = await runRow(
        client,
        `insert into budgets (id, user_id, category_id, amount, deleted_at)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set
           category_id = excluded.category_id,
           amount = excluded.amount,
           deleted_at = excluded.deleted_at
         where budgets.user_id = excluded.user_id
         returning id`,
        [row.id, userId, row.categoryId, row.amount, row.deletedAt],
      );
      if (ok) result.applied.budgets.push(row.id);
      else
        result.rejected.push({
          entity: "budgets",
          id: row.id,
          reason: "该记录属于其他账号",
        });
    } catch (error) {
      result.rejected.push({
        entity: "budgets",
        id: row.id,
        reason: errorMessage(error),
      });
    }
  }
}

async function applySettings(
  client: PoolClient,
  userId: string,
  settings: UserSettingsRow,
  result: PushResult,
): Promise<void> {
  if (settings.defaultAccountId) {
    const owned = await ownedIds(client, "accounts", userId, [
      settings.defaultAccountId,
    ]);
    if (!owned.has(settings.defaultAccountId)) {
      result.rejected.push({
        entity: "settings",
        id: userId,
        reason: "默认账户不存在",
      });
      return;
    }
  }
  await client.query(
    `insert into user_settings (user_id, default_account_id, period_start_day)
     values ($1, $2, $3)
     on conflict (user_id) do update set
       default_account_id = excluded.default_account_id,
       period_start_day = excluded.period_start_day`,
    [userId, settings.defaultAccountId, settings.periodStartDay],
  );
  result.applied.settings.push(userId);
}

/** 在调用方已有的连接 / 事务里应用一批变更（备份恢复会复用它） */
export async function applyPushWithClient(
  client: PoolClient,
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const result: PushResult = { applied: emptyApplied(), rejected: [] };

  if (payload.accounts?.length) {
    await applyAccounts(client, userId, payload.accounts, result);
  }
  if (payload.categories?.length) {
    await applyCategories(client, userId, payload.categories, result);
  }
  if (payload.importBatches?.length) {
    await applyImportBatches(client, userId, payload.importBatches, result);
  }
  if (payload.transactions?.length) {
    await applyTransactions(client, userId, payload.transactions, result);
  }
  if (payload.budgets?.length) {
    await applyBudgets(client, userId, payload.budgets, result);
  }
  if (payload.settings) {
    await applySettings(client, userId, payload.settings, result);
  }

  return result;
}

export function applyPush(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  return withTransaction((client) =>
    applyPushWithClient(client, userId, payload),
  );
}
