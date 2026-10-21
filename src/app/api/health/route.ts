import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 部署自检：只回答"配置是否可用"，绝不返回凭据本身。
// 用途：Vercel 上 /api/v1/* 全线 500 时，直接访问 /api/health 就能定位是哪一项环境变量坏了。
// 注意：这里不能静态 import "@/server/db"，否则缺 DATABASE_URL 时本路由自己也会 500。

interface Check {
  configured: boolean;
  valid: boolean;
  detail: string;
}

function checkAuthBaseUrl(
  raw: string | undefined,
): Check & { host: string | null } {
  if (!raw) {
    return {
      configured: false,
      valid: false,
      detail: "缺少 NEON_AUTH_BASE_URL",
      host: null,
    };
  }
  try {
    // 与 SDK 内部 getUpstreamURL 完全一致的拼接方式
    const url = new URL(`${raw}/get-session`);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return {
        configured: true,
        valid: false,
        detail: `协议必须是 http(s)，当前是 ${url.protocol}`,
        host: null,
      };
    }
    return {
      configured: true,
      valid: true,
      detail: "格式正常",
      host: url.host,
    };
  } catch {
    return {
      configured: true,
      valid: false,
      detail: "不是合法的绝对 URL（常见原因：少了 https:// 或被引号/换行包裹）",
      host: null,
    };
  }
}

function checkCookieSecret(raw: string | undefined): Check {
  if (!raw) {
    return {
      configured: false,
      valid: false,
      detail: "缺少 NEON_AUTH_COOKIE_SECRET",
    };
  }
  if (raw.length < 32) {
    return {
      configured: true,
      valid: false,
      detail: `长度 ${raw.length}，SDK 要求至少 32 字符`,
    };
  }
  return { configured: true, valid: true, detail: "格式正常" };
}

export async function GET() {
  const auth = checkAuthBaseUrl(process.env.NEON_AUTH_BASE_URL);
  const secret = checkCookieSecret(process.env.NEON_AUTH_COOKIE_SECRET);
  const dbUrl = process.env.DATABASE_URL;

  let database: Check & { latencyMs: number | null } = {
    configured: Boolean(dbUrl),
    valid: false,
    detail: dbUrl ? "未检测" : "缺少 DATABASE_URL",
    latencyMs: null,
  };

  if (dbUrl) {
    const startedAt = Date.now();
    try {
      // 动态导入：db.ts 在模块顶层校验 DATABASE_URL，失败也只会落到这里的 catch
      const { query } = await import("@/server/db");
      await query("select 1");
      database = {
        configured: true,
        valid: true,
        detail: "连接正常",
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      database = {
        configured: true,
        valid: false,
        detail:
          error instanceof Error ? error.message.slice(0, 200) : "连接失败",
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  const ok = auth.valid && secret.valid && database.valid;

  return NextResponse.json(
    {
      ok,
      auth: { baseUrl: auth, cookieSecret: secret },
      database,
    },
    { status: ok ? 200 : 503 },
  );
}
