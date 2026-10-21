import { requireUser } from "@/server/auth";
import { jsonOk, route } from "@/server/http";
import { deleteAuthUser, purgeUserData } from "@/server/services/backup";

export const dynamic = "force-dynamic";

// 账号注销：清空该账号的全部业务数据，并删除 Neon Auth 用户（会话随之失效）
export const DELETE = route(async () => {
  const user = await requireUser();
  await purgeUserData(user.id);
  const accountDeleted = await deleteAuthUser(user.id);
  return jsonOk({ ok: true, accountDeleted });
});
