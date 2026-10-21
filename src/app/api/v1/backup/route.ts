import { requireUser } from "@/server/auth";
import { jsonOk, route } from "@/server/http";
import { exportBackup, restoreBackup } from "@/server/services/backup";
import { restoreSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

// 云端全量备份导出
export const GET = route(async () => {
  const user = await requireUser();
  return jsonOk(await exportBackup(user.id));
});

// 覆盖式恢复：清空云端数据后写入备份内容
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const payload = restoreSchema.parse(await request.json());
  const result = await restoreBackup(user.id, payload);
  return jsonOk(result);
});
