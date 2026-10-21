import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

// 数据库凭据只存在于服务端：浏览器永远拿不到 DATABASE_URL。
// 连接串用 Neon 的 pooled 地址（-pooler），适合无服务器/多实例部署。

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("缺少 DATABASE_URL，请检查 .env.local（pnpm env:pull）");
}

const globalForDb = globalThis as unknown as { cashflowPool?: Pool };

const pool =
  globalForDb.cashflowPool ??
  new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

// 开发环境热更新时复用连接池，避免连接泄漏
if (process.env.NODE_ENV !== "production") {
  globalForDb.cashflowPool = pool;
}

export function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return pool.query<T>(text, params).then((result) => result.rows);
}

/** 单行查询，无结果返回 null */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
