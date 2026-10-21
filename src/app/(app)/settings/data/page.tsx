"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { showToast } from "@/components/toast";
import { currentYm, ymKeyToRange, ymToKey } from "@/lib/date";
import {
  type BackupFile,
  backupFilename,
  clearAllData,
  downloadFile,
  exportBackup,
  getDeviceSettings,
  markExported,
  restoreBackup,
  toCsv,
} from "@/lib/repo";
import { useLedger } from "@/lib/use-ledger";

const BACKUP_REMIND_DAYS = 14; // DAT-05

export default function DataSettingsPage() {
  const ledger = useLedger();
  const [csvFrom, setCsvFrom] = useState(
    ymKeyToRange(ymToKey(currentYm())).from,
  );
  const [csvTo, setCsvTo] = useState(ymKeyToRange(ymToKey(currentYm())).to);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const [clearText, setClearText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getDeviceSettings().then((settings) =>
      setLastExportAt(settings.lastExportAt),
    );
  }, []);

  const needBackup =
    lastExportAt === null ||
    Date.now() - new Date(lastExportAt).getTime() >
      BACKUP_REMIND_DAYS * 86_400_000;

  async function handleExportJson() {
    const backup = await exportBackup();
    downloadFile(
      backupFilename(),
      JSON.stringify(backup, null, 2),
      "application/json",
    );
    await markExported();
    setLastExportAt(new Date().toISOString());
    showToast("已导出 JSON 备份");
  }

  async function handleExportCsv() {
    if (!ledger) return;
    const rows = ledger.transactions
      .filter(
        (t) => !t.deletedAt && t.occurredOn >= csvFrom && t.occurredOn <= csvTo,
      )
      .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
      .map((txn) => {
        const category = ledger.categories.find((c) => c.id === txn.categoryId);
        const parent = category?.parentId
          ? ledger.categories.find((c) => c.id === category.parentId)
          : undefined;
        const account = ledger.accounts.find((a) => a.id === txn.accountId);
        const toAccount = ledger.accounts.find((a) => a.id === txn.toAccountId);
        return {
          date: txn.occurredOn,
          kind: txn.kind,
          amountCents: txn.amount,
          categoryName: category
            ? [parent?.name, category.name].filter(Boolean).join("/")
            : "",
          accountName: account?.name ?? "",
          toAccountName: toAccount?.name ?? "",
          note: [txn.payee, txn.note].filter(Boolean).join(" "),
          tags: txn.tags,
        };
      });
    downloadFile(
      `cashflow-${csvFrom}-to-${csvTo}.csv`,
      toCsv(rows),
      "text/csv",
    );
    showToast(`已导出 ${rows.length} 条明细`);
  }

  async function handleRestoreFile(file: File) {
    if (!window.confirm("恢复将覆盖当前全部数据，且不可撤销。确认继续？"))
      return;
    setBusy(true);
    try {
      const content = await file.text();
      const backup = JSON.parse(content) as BackupFile;
      await restoreBackup(backup);
      showToast("恢复完成");
      setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "恢复失败，请检查文件",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll() {
    if (clearText !== "确认") {
      showToast("请先在输入框中输入「确认」");
      return;
    }
    if (
      !window.confirm(
        "将删除本机全部数据并恢复默认分类与账户，不可撤销。确认？",
      )
    )
      return;
    await clearAllData();
    showToast("已清空全部数据");
    setTimeout(() => window.location.reload(), 600);
  }

  const exportableCount = ledger
    ? ledger.transactions.filter(
        (t) => !t.deletedAt && t.occurredOn >= csvFrom && t.occurredOn <= csvTo,
      ).length
    : 0;

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
        <h1 className="text-xl font-semibold">数据管理</h1>
      </header>

      {needBackup ? (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          距上次导出已超过 {BACKUP_REMIND_DAYS} 天，建议先导出 JSON
          备份（DAT-05）。
        </p>
      ) : null}

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-semibold">导出备份（DAT-02）</h2>
        <p className="text-xs text-muted-foreground">
          包含账户、分类、记录、预算、导入批次与设置，可用于恢复或迁移。
        </p>
        <button
          type="button"
          onClick={handleExportJson}
          className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          导出 JSON 完整备份
        </button>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-semibold">导出 CSV 明细（DAT-03）</h2>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={csvFrom}
            onChange={(event) => setCsvFrom(event.target.value)}
            className="min-h-10 flex-1 rounded-lg border border-border bg-background px-2"
            aria-label="开始日期"
          />
          <span className="text-muted-foreground">至</span>
          <input
            type="date"
            value={csvTo}
            onChange={(event) => setCsvTo(event.target.value)}
            className="min-h-10 flex-1 rounded-lg border border-border bg-background px-2"
            aria-label="结束日期"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          将导出 {exportableCount} 条记录（日期区间如上，默认本月）
        </p>
        <button
          type="button"
          onClick={handleExportCsv}
          className="min-h-11 rounded-xl bg-muted text-sm font-medium"
        >
          导出 CSV
        </button>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-semibold">从 JSON 恢复（DAT-04）</h2>
        <p className="text-xs text-muted-foreground">
          将覆盖当前全部数据，请先导出备份。
        </p>
        <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-destructive/40 text-sm text-destructive">
          选择备份文件并恢复
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleRestoreFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-semibold text-destructive">
          清空全部数据（DAT-06）
        </h2>
        <p className="text-xs text-muted-foreground">
          删除本机全部账单并恢复默认分类与账户；此操作不可撤销（云同步上线后也会同步删除云端数据）。
        </p>
        <input
          value={clearText}
          onChange={(event) => setClearText(event.target.value)}
          placeholder="输入「确认」以启用"
          className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm"
        />
        <button
          type="button"
          onClick={handleClearAll}
          disabled={clearText !== "确认"}
          className="min-h-11 rounded-xl bg-destructive text-sm font-semibold text-white disabled:opacity-40"
        >
          清空全部数据
        </button>
      </section>

      <p className="text-xs text-muted-foreground">
        备份文件包含 schemaVersion，升级后仍可恢复旧备份。
      </p>
    </main>
  );
}
