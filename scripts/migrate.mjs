// 极简迁移执行器：按文件名顺序执行 db/migrations/*.sql，已执行过的跳过。
// 用法：pnpm db:migrate（脚本内部通过 --env-file 读取 .env.local）
// 迁移必须走直连（非 -pooler）连接串：DATABASE_URL_UNPOOLED 优先。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  console.error(
    "缺少 DATABASE_URL_UNPOOLED / DATABASE_URL，请先配置 .env.local",
  );
  process.exit(1);
}

const dir = path.join(process.cwd(), "db", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query(`
  create table if not exists public.schema_migrations (
    name        text primary key,
    applied_at  timestamptz not null default now()
  )
`);

const { rows } = await client.query(
  "select name from public.schema_migrations",
);
const done = new Set(rows.map((row) => row.name));

for (const file of files) {
  if (done.has(file)) {
    console.log(`跳过 ${file}`);
    continue;
  }
  const sql = await readFile(path.join(dir, file), "utf8");
  console.log(`执行 ${file} …`);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into public.schema_migrations (name) values ($1)",
      [file],
    );
    await client.query("commit");
    console.log(`完成 ${file}`);
  } catch (error) {
    await client.query("rollback");
    console.error(
      `失败 ${file}:`,
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    break;
  }
}

await client.end();
