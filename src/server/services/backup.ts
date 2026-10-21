import "server-only";

import type { PoolClient } from "pg";
import type {
  Account,
  Budget,
  Category,
  ImportBatch,
  Transaction,
  UserSettings,
} from "@/lib/types";
import { query, withTransaction } from "@/server/db";
import { exportAll } from "@/server/repositories";
import { applyPushWithClient, type PushResult } from "@/server/services/sync";
import type { RestorePayload } from "@/server/validation";

// 云端备份 / 恢复（DAT-06 / DAT-07 的服务端实现）。
// 恢复是「覆盖式」：先清空该账号在云端的全部业务数据，再按依赖顺序写入备份内容。

export const BACKUP_SCHEMA_VERSION = 1;

export interface CloudBackup {
  schemaVersion: number;
  exportedAt: string;
  accounts: Account[];
  categories: Category[];
  importBatches: ImportBatch[];
  transactions: Transaction[];
  budgets: Budget[];
  settings: UserSettings | null;
}

/** 删除该账号的全部业务数据（账号注销 / 恢复前清空共用） */
async function deleteAllRows(
  client: PoolClient,
  userId: string,
): Promise<void> {
  // 顺序与依赖相反：先删引用方，再删被引用方
  await client.query("delete from transactions where user_id = $1", [userId]);
  await client.query("delete from budgets where user_id = $1", [userId]);
  await client.query("delete from import_batches where user_id = $1", [userId]);
  await client.query("delete from categories where user_id = $1", [userId]);
  await client.query("delete from accounts where user_id = $1", [userId]);
  await client.query("delete from user_settings where user_id = $1", [userId]);
}

export async function exportBackup(userId: string): Promise<CloudBackup> {
  const data = await exportAll(userId);
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: data.accounts,
    categories: data.categories,
    importBatches: data.importBatches,
    transactions: data.transactions,
    budgets: data.budgets,
    settings: data.settings,
  };
}

export async function purgeUserData(userId: string): Promise<void> {
  await withTransaction((client) => deleteAllRows(client, userId));
}

/**
 * 删除 Neon Auth 用户（neon_auth 的会话/账号/成员表都是 ON DELETE CASCADE）。
 * 注销是用户主动行为，服务端直接删除；不需要 Auth 管理员权限。
 */
export async function deleteAuthUser(userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'delete from neon_auth."user" where id = $1 returning id',
    [userId],
  );
  return rows.length > 0;
}

export async function restoreBackup(
  userId: string,
  payload: RestorePayload,
): Promise<PushResult> {
  return withTransaction(async (client) => {
    await deleteAllRows(client, userId);
    return applyPushWithClient(client, userId, payload);
  });
}
