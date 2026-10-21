import { requireUser } from "@/server/auth";
import { queryOne } from "@/server/db";
import { ApiError, jsonOk, route } from "@/server/http";
import { PULL_PAGE_SIZE, pullChanges } from "@/server/repositories";

export const dynamic = "force-dynamic";

// 增量拉取：GET /api/v1/sync/pull?cursor=<ISO>
// 返回该游标之后被服务端改动的行、新游标，以及是否还有下一页。
// 任一实体取满一页时，游标停在本页最后一条的 updated_at 上，避免分页漏数据。
export const GET = route(async (request: Request) => {
  const user = await requireUser();
  const raw = new URL(request.url).searchParams.get("cursor");

  let cursor = new Date(0);
  if (raw) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new ApiError(400, "cursor 不是合法的 ISO 时间");
    }
    cursor = parsed;
  }

  const [data, clock] = await Promise.all([
    pullChanges(user.id, cursor),
    queryOne<{ now: Date }>("select now() as now"),
  ]);

  const lists = [
    data.accounts,
    data.categories,
    data.importBatches,
    data.transactions,
    data.budgets,
  ];
  const hasMore = lists.some((rows) => rows.length >= PULL_PAGE_SIZE);
  const serverTime = clock?.now ?? new Date();

  let nextCursor = serverTime;
  if (hasMore) {
    let max = cursor.getTime();
    for (const rows of lists) {
      for (const row of rows) {
        const time = new Date(row.updatedAt).getTime();
        if (time > max) max = time;
      }
    }
    nextCursor = new Date(max);
  }

  return jsonOk({
    cursor: nextCursor.toISOString(),
    hasMore,
    ...data,
  });
});
