import { auth } from "@/server/auth";

// Neon Auth 的同源代理：浏览器只与 /api/auth/* 通信，
// 会话 cookie 由这里写入（HttpOnly），前端拿不到 Auth 分支的凭据。
export const { GET, POST, PUT, DELETE, PATCH } = auth.handler();
