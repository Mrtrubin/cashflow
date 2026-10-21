"use client";

import {
  ChevronRight,
  CloudUpload,
  Coins,
  DatabaseBackup,
  FileInput,
  Moon,
  Palette,
  Star,
  Tags,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getDeviceSettings,
  listAccounts,
  saveDeviceSettings,
} from "@/lib/repo";
import { loadTheme, saveTheme, type Theme } from "@/lib/theme";
import type { Account } from "@/lib/types";

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    void (async () => {
      setAccounts(await listAccounts());
      const settings = await getDeviceSettings();
      setDefaultAccountId(settings.defaultAccountId);
      setTheme(loadTheme());
    })();
  }, []);

  async function handleDefaultAccount(id: string) {
    setDefaultAccountId(id);
    await saveDeviceSettings({ defaultAccountId: id });
  }

  function handleTheme(value: Theme) {
    setTheme(value);
    saveTheme(value);
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 pt-3 pb-6">
      <header>
        <h1 className="text-xl font-semibold">设置</h1>
      </header>

      <nav
        className="flex flex-col divide-y divide-border/60 rounded-2xl border border-border"
        aria-label="设置入口"
      >
        <EntryLink
          href="/settings/account"
          icon={<CloudUpload className="size-4" aria-hidden="true" />}
          label="账号与同步"
        />
        <EntryLink
          href="/settings/accounts"
          icon={<Wallet className="size-4" aria-hidden="true" />}
          label="账户管理"
        />
        <EntryLink
          href="/settings/categories"
          icon={<Tags className="size-4" aria-hidden="true" />}
          label="分类管理"
        />
        <EntryLink
          href="/settings/import"
          icon={<FileInput className="size-4" aria-hidden="true" />}
          label="文本导入"
        />
        <EntryLink
          href="/settings/data"
          icon={<DatabaseBackup className="size-4" aria-hidden="true" />}
          label="数据管理"
        />
      </nav>

      <section className="flex flex-col gap-3" aria-label="偏好设置">
        <h2 className="text-sm font-semibold text-muted-foreground">偏好</h2>

        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <Star className="size-4 text-muted-foreground" aria-hidden="true" />
            默认账户
          </span>
          <select
            value={defaultAccountId ?? ""}
            onChange={(event) => handleDefaultAccount(event.target.value)}
            className="min-h-9 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="" disabled>
              请选择
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <Palette
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            主题（仅本机）
          </span>
          <div className="flex rounded-lg bg-muted p-0.5">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleTheme(option.value)}
                className={
                  theme === option.value
                    ? "min-h-8 rounded-md bg-background px-3 text-xs font-medium shadow-sm"
                    : "min-h-8 rounded-md px-3 text-xs text-muted-foreground"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-11 items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Coins
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            币种
          </span>
          <span className="text-muted-foreground">CNY（人民币）</span>
        </div>

        <div className="flex min-h-11 items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Moon className="size-4 text-muted-foreground" aria-hidden="true" />
            版本
          </span>
          <span className="text-muted-foreground">v0.1（本机版）</span>
        </div>
      </section>
    </main>
  );
}

function EntryLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-12 items-center justify-between px-4 text-sm"
    >
      <span className="flex items-center gap-3">
        {icon}
        {label}
      </span>
      <ChevronRight
        className="size-4 text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}
