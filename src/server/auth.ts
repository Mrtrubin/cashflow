import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";
import { ApiError } from "@/server/http";

// Neon Auth = Managed Better Auth：用户与会话存放在 neon_auth schema，
// 登录方式为邮箱验证码（emailOtp）。会话 cookie 由本应用的 /api/auth 代理写入。

const baseUrl = process.env.NEON_AUTH_BASE_URL;
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;

if (!baseUrl || !cookieSecret) {
  throw new Error(
    "缺少 NEON_AUTH_BASE_URL 或 NEON_AUTH_COOKIE_SECRET，请检查 .env.local",
  );
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret: cookieSecret },
});

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

/** 取当前登录用户；未登录抛 401（所有 /api/v1 路由都先经过这里） */
export async function requireUser(): Promise<CurrentUser> {
  const { data, error } = await auth.getSession();
  const user = data?.user;
  if (error || !user) {
    throw new ApiError(401, "未登录或会话已过期");
  }
  return { id: user.id, email: user.email, name: user.name };
}
