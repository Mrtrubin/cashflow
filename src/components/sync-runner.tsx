"use client";

import { useEffect } from "react";
import { syncNow } from "@/lib/sync";

const INTERVAL_MS = 30_000;

/**
 * 后台同步：进入应用、回到前台、恢复网络以及每 30 秒各尝试一次。
 * 未登录或断网时 syncNow 会直接返回，不影响本机使用。
 */
export function SyncRunner() {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void syncNow().catch((error) => {
        console.warn("[sync] 自动同步失败", error);
      });
    };

    tick();
    const timer = window.setInterval(tick, INTERVAL_MS);
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", tick);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return null;
}
