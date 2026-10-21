import "server-only";

import type { PoolClient } from "pg";
import { query } from "@/server/db";
import type {
  AccountRow,
  BudgetRow,
  CategoryRow,
  ImportBatchRow,
  TransactionRow,
  UserSettingsRow,
} from "@/server/validation";

// 数据访问层：把 snake_case 的库表行映射成客户端的 camelCase 领域对象。
// updated_at / created_at 由数据库触发器写入服务端时间，客户端传来的时间只用于展示。

interface AccountDbRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  opening_balance: string;
  archived: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface CategoryDbRow {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  icon: string;
  color: string;
  archived: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface ImportBatchDbRow {
  id: string;
  source: string;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface TransactionDbRow {
  id: string;
  kind: string;
  amount: string;
  occurred_on: string;
  occurred_time: string | null;
  category_id: string | null;
  account_id: string;
  to_account_id: string | null;
  payee: string | null;
  note: string | null;
  tags: string[];
  import_batch_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface BudgetDbRow {
  id: string;
  category_id: string | null;
  amount: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface SettingsDbRow {
  default_account_id: string | null;
  period_start_day: number;
  updated_at: Date;
}

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

export function mapAccount(row: AccountDbRow): AccountRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountRow["type"],
    currency: "CNY",
    openingBalance: Number(row.opening_balance),
    archived: row.archived,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: iso(row.deleted_at),
  };
}

export function mapCategory(row: CategoryDbRow): CategoryRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CategoryRow["kind"],
    parentId: row.parent_id,
    icon: row.icon,
    color: row.color,
    archived: row.archived,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: iso(row.deleted_at),
  };
}

export function mapImportBatch(row: ImportBatchDbRow): ImportBatchRow {
  return {
    id: row.id,
    source: row.source as ImportBatchRow["source"],
    total: row.total,
    imported: row.imported,
    skipped: row.skipped,
    failed: row.failed,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: iso(row.deleted_at),
  };
}

export function mapTransaction(row: TransactionDbRow): TransactionRow {
  return {
    id: row.id,
    kind: row.kind as TransactionRow["kind"],
    amount: Number(row.amount),
    occurredOn: row.occurred_on,
    occurredAt: row.occurred_time ? row.occurred_time.slice(0, 5) : null,
    categoryId: row.category_id,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    payee: row.payee,
    note: row.note,
    tags: row.tags,
    importBatchId: row.import_batch_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: iso(row.deleted_at),
  };
}

export function mapBudget(row: BudgetDbRow): BudgetRow {
  return {
    id: row.id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: iso(row.deleted_at),
  };
}

export function mapSettings(row: SettingsDbRow): UserSettingsRow {
  return {
    defaultAccountId: row.default_account_id,
    periodStartDay: row.period_start_day,
    updatedAt: row.updated_at.toISOString(),
  };
}

/** occurred_on 用 ::text 取出，避免时区把日期整体偏移一天 */
const ACCOUNT_COLUMNS = `id, name, type, currency, opening_balance, archived, sort_order, created_at, updated_at, deleted_at`;
const CATEGORY_COLUMNS = `id, name, kind, parent_id, icon, color, archived, sort_order, created_at, updated_at, deleted_at`;
const IMPORT_BATCH_COLUMNS = `id, source, total, imported, skipped, failed, created_at, updated_at, deleted_at`;
const TRANSACTION_COLUMNS = `id, kind, amount, occurred_on::text as occurred_on, occurred_time::text as occurred_time, category_id, account_id, to_account_id, payee, note, tags, import_batch_id, created_at, updated_at, deleted_at`;
const BUDGET_COLUMNS = `id, category_id, amount, created_at, updated_at, deleted_at`;
const SETTINGS_COLUMNS = `default_account_id, period_start_day, updated_at`;

export interface PullResult {
  accounts: AccountRow[];
  categories: CategoryRow[];
  importBatches: ImportBatchRow[];
  transactions: TransactionRow[];
  budgets: BudgetRow[];
  settings: UserSettingsRow | null;
}

/** 单次拉取每个实体的最大行数，route 用它判断是否还有下一页 */
export const PULL_PAGE_SIZE = 500;

/** 增量拉取：updated_at > cursor 的行，按 updated_at 升序（回看窗口由客户端处理） */
export async function pullChanges(
  userId: string,
  cursor: Date,
): Promise<PullResult> {
  const [accounts, categories, importBatches, transactions, budgets, settings] =
    await Promise.all([
      query<AccountDbRow>(
        `select ${ACCOUNT_COLUMNS} from accounts
          where user_id = $1 and updated_at > $2
          order by updated_at asc, id asc limit $3`,
        [userId, cursor, PULL_PAGE_SIZE],
      ),
      query<CategoryDbRow>(
        `select ${CATEGORY_COLUMNS} from categories
          where user_id = $1 and updated_at > $2
          order by updated_at asc, id asc limit $3`,
        [userId, cursor, PULL_PAGE_SIZE],
      ),
      query<ImportBatchDbRow>(
        `select ${IMPORT_BATCH_COLUMNS} from import_batches
          where user_id = $1 and updated_at > $2
          order by updated_at asc, id asc limit $3`,
        [userId, cursor, PULL_PAGE_SIZE],
      ),
      query<TransactionDbRow>(
        `select ${TRANSACTION_COLUMNS} from transactions
          where user_id = $1 and updated_at > $2
          order by updated_at asc, id asc limit $3`,
        [userId, cursor, PULL_PAGE_SIZE],
      ),
      query<BudgetDbRow>(
        `select ${BUDGET_COLUMNS} from budgets
          where user_id = $1 and updated_at > $2
          order by updated_at asc, id asc limit $3`,
        [userId, cursor, PULL_PAGE_SIZE],
      ),
      query<SettingsDbRow>(
        `select ${SETTINGS_COLUMNS} from user_settings
          where user_id = $1 and updated_at > $2 limit 1`,
        [userId, cursor],
      ),
    ]);

  return {
    accounts: accounts.map(mapAccount),
    categories: categories.map(mapCategory),
    importBatches: importBatches.map(mapImportBatch),
    transactions: transactions.map(mapTransaction),
    budgets: budgets.map(mapBudget),
    settings: settings[0] ? mapSettings(settings[0]) : null,
  };
}

/** 全量导出（含软删除行），用于备份 */
export async function exportAll(userId: string): Promise<PullResult> {
  const [accounts, categories, importBatches, transactions, budgets, settings] =
    await Promise.all([
      query<AccountDbRow>(
        `select ${ACCOUNT_COLUMNS} from accounts where user_id = $1 order by sort_order, created_at`,
        [userId],
      ),
      query<CategoryDbRow>(
        `select ${CATEGORY_COLUMNS} from categories where user_id = $1 order by sort_order, created_at`,
        [userId],
      ),
      query<ImportBatchDbRow>(
        `select ${IMPORT_BATCH_COLUMNS} from import_batches where user_id = $1 order by created_at`,
        [userId],
      ),
      query<TransactionDbRow>(
        `select ${TRANSACTION_COLUMNS} from transactions where user_id = $1 order by occurred_on, created_at`,
        [userId],
      ),
      query<BudgetDbRow>(
        `select ${BUDGET_COLUMNS} from budgets where user_id = $1 order by created_at`,
        [userId],
      ),
      query<SettingsDbRow>(
        `select ${SETTINGS_COLUMNS} from user_settings where user_id = $1`,
        [userId],
      ),
    ]);

  return {
    accounts: accounts.map(mapAccount),
    categories: categories.map(mapCategory),
    importBatches: importBatches.map(mapImportBatch),
    transactions: transactions.map(mapTransaction),
    budgets: budgets.map(mapBudget),
    settings: settings[0] ? mapSettings(settings[0]) : null,
  };
}

/** 某张表里属于该用户的 id 集合，用于外键归属校验 */
export async function ownedIds(
  client: PoolClient,
  table: "accounts" | "categories" | "import_batches",
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = await client.query<{ id: string }>(
    `select id from ${table} where user_id = $1 and id = any($2::uuid[])`,
    [userId, ids],
  );
  return new Set(result.rows.map((row) => row.id));
}
