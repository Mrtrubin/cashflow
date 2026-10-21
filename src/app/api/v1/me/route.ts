import { requireUser } from "@/server/auth";
import { jsonOk, route } from "@/server/http";

export const dynamic = "force-dynamic";

// 当前登录用户：客户端用来判断同步是否可用
export const GET = route(async () => {
  const user = await requireUser();
  return jsonOk({ user });
});
