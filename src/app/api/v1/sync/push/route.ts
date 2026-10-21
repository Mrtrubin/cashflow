import { requireUser } from "@/server/auth";
import { jsonOk, route } from "@/server/http";
import { applyPush } from "@/server/services/sync";
import { parsePushBody } from "@/server/validation";

export const dynamic = "force-dynamic";

// 推送本机变更：{ accounts?, categories?, importBatches?, transactions?, budgets?, settings? }
// 逐行校验 + 逐行入库，返回被接收与被拒绝的 id。
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const { payload, rejected } = parsePushBody(await request.json());
  const result = await applyPush(user.id, payload);
  return jsonOk({
    applied: result.applied,
    rejected: [...rejected, ...result.rejected],
  });
});
