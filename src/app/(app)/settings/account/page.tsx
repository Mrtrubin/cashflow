"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { showToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { pendingCount, type SyncOutcome, syncNow } from "@/lib/sync";

/** 账号与同步：登录状态、手动同步、退出登录 */
export default function AccountSettingsPage() {
  const { data: session, isPending } = authClient.useSession();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  useEffect(() => {
    void pendingCount().then(setPending);
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await syncNow();
      setOutcome(result);
      setPending(await pendingCount());
      showToast(
        result.rejected > 0
          ? `同步完成，${result.rejected} 条被服务端拒绝`
          : "同步完成",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSignOut() {
    if (!window.confirm("退出后将停止云同步，本机数据保留。确认退出登录？")) {
      return;
    }
    await authClient.signOut();
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-6">
      <header className="flex items-center gap-2">
        <Link
          href="/settings"
          aria-label="返回"
          className="flex size-10 items-center justify-center rounded-full"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-xl font-semibold">账号与同步</h1>
      </header>

      {isPending ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : session?.user ? (
        <section className="flex flex-col gap-3">
          <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
            <p className="text-xs text-muted-foreground">当前账号</p>
            <p className="mt-0.5 font-medium">{session.user.email}</p>
          </div>

          <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
            <p className="text-xs text-muted-foreground">同步状态</p>
            <p className="mt-0.5">
              {pending > 0
                ? `本机有 ${pending} 条变更待上传`
                : "本机变更已全部上传"}
            </p>
            {outcome ? (
              <p className="mt-1 text-xs text-muted-foreground">
                上次同步 {new Date(outcome.at).toLocaleTimeString("zh-CN")}：
                上传 {outcome.pushed} 条，拉取 {outcome.pulled} 条
              </p>
            ) : null}
          </div>

          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? "同步中…" : "立即同步"}
          </Button>
          <p className="text-xs text-muted-foreground">
            账单会先写入本机，联网时自动同步到云端；断网时照常记账。
          </p>
          <Button variant="outline" onClick={handleSignOut}>
            退出登录
          </Button>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            未登录。登录后可在多台设备间同步账单；不登录也可以在本机正常使用。
          </p>
          <Link
            href="/login"
            className="flex min-h-11 items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground"
          >
            登录 / 注册
          </Link>
        </section>
      )}
    </main>
  );
}
