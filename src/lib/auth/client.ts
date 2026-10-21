"use client";

import { createAuthClient } from "@neondatabase/auth/next";

// 浏览器端 Auth 客户端：只与同源的 /api/auth/* 通信（Next 代理到 Neon Auth）。
// 会话存放在 HttpOnly cookie 中，前端读不到 token。
export const authClient = createAuthClient();
