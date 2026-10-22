"use client";

import { ChevronLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { showToast } from "@/components/toast";
import { getDb } from "@/lib/db";
import { formatCents, parseAmountToCents } from "@/lib/money";
import {
  createAccount,
  getDefaultAccountId,
  listAccounts,
  listTransactions,
  saveDeviceSettings,
  updateAccount,
} from "@/lib/repo";
import { accountBalance } from "@/lib/stats";
import type { Account, AccountType } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";

const TYPE_OPTIONS = Object.entries(ACCOUNT_TYPE_LABELS) as Array<
  [AccountType, string]
>;

interface AccountsSnapshot {
  accounts: Account[];
  balances: Record<string, number>;
  defaultAccountId: string | null;
}

/** 账户列表 + 每个账户的当前余额（含已归档账户） */
async function fetchSnapshot(): Promise<AccountsSnapshot> {
  await getDb();
  const [accounts, txns, defaultAccountId] = await Promise.all([
    listAccounts(true), // 含已归档
    listTransactions(),
    getDefaultAccountId(),
  ]);
  const balances: Record<string, number> = {};
  for (const account of accounts) {
    balances[account.id] = accountBalance(account, txns);
  }
  return { accounts, balances, defaultAccountId };
}

// 快照为空时用模块级常量兜底，避免每次渲染产生新引用
const EMPTY_ACCOUNTS: Account[] = [];
const EMPTY_BALANCES: Record<string, number> = {};

export default function AccountsSettingsPage() {
  const [snapshot, setSnapshot] = useState<AccountsSnapshot | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "ewallet" as AccountType,
    opening: "",
  });

  const accounts = snapshot?.accounts ?? EMPTY_ACCOUNTS;
  const balances = snapshot?.balances ?? EMPTY_BALANCES;
  const defaultId = snapshot?.defaultAccountId ?? null;

  // 挂载时加载一次：依赖为空，不引用组件内的函数，组件重渲染不会重复请求
  useEffect(() => {
    let cancelled = false;
    void fetchSnapshot()
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {
        if (!cancelled) showToast("账户加载失败，请刷新重试");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 增删改之后重新拉取（只在事件回调里调用） */
  async function reload(): Promise<void> {
    setSnapshot(await fetchSnapshot());
  }

  function startEdit(account: Account) {
    setEditingId(account.id);
    setAdding(false);
    setForm({
      name: account.name,
      type: account.type,
      opening: (account.openingBalance / 100).toFixed(2),
    });
  }

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setForm({ name: "", type: "ewallet", opening: "" });
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      showToast("请输入账户名称");
      return;
    }
    const openingCents = form.opening ? parseAmountToCents(form.opening) : 0;
    if (form.opening && openingCents === null) {
      showToast("初始余额格式不正确");
      return;
    }
    const opening = openingCents ?? 0;
    if (adding) {
      await createAccount({
        name,
        type: form.type,
        openingBalance: opening,
        archived: false,
      });
      showToast(`已添加账户「${name}」`);
    } else if (editingId) {
      await updateAccount(editingId, {
        name,
        type: form.type,
        openingBalance: opening,
      });
      showToast("已保存修改");
    }
    setAdding(false);
    setEditingId(null);
    await reload();
  }

  async function toggleArchive(account: Account) {
    const next = !account.archived;
    if (!next && !window.confirm(`恢复账户「${account.name}」？`)) return;
    if (
      next &&
      !window.confirm(
        `归档后「${account.name}」不再出现在选择列表，历史数据保留。确认归档？`,
      )
    ) {
      return;
    }
    await updateAccount(account.id, { archived: next });
    await reload();
  }

  async function setAsDefault(account: Account) {
    await saveDeviceSettings({ defaultAccountId: account.id });
    setSnapshot((current) =>
      current ? { ...current, defaultAccountId: account.id } : current,
    );
    showToast(`已将「${account.name}」设为默认账户`);
  }

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const editing = editingId ? accounts.find((a) => a.id === editingId) : null;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            aria-label="返回"
            className="flex size-10 items-center justify-center rounded-full"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="text-xl font-semibold">账户管理</h1>
        </div>
        <button
          type="button"
          onClick={startAdd}
          aria-label="新增账户"
          className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </header>

      {(adding || editing) && (
        <section className="flex flex-col gap-2 rounded-2xl border border-border p-3">
          <h2 className="text-sm font-semibold">
            {adding ? "新增账户" : "编辑账户"}
          </h2>
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="账户名称"
            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.type}
              onChange={(event) =>
                setForm({ ...form, type: event.target.value as AccountType })
              }
              className="min-h-11 rounded-xl border border-border bg-background px-2 text-sm"
              aria-label="账户类型"
            >
              {TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={form.opening}
              onChange={(event) =>
                setForm({ ...form, opening: event.target.value })
              }
              placeholder="初始余额（元）"
              inputMode="decimal"
              className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="min-h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setEditingId(null);
              }}
              className="min-h-11 rounded-xl bg-muted px-4 text-sm"
            >
              取消
            </button>
          </div>
        </section>
      )}

      <section className="flex flex-col divide-y divide-border/60 rounded-2xl border border-border">
        {active.map((account) => (
          <div key={account.id} className="flex items-center gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => startEdit(account)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                {account.name}
                {defaultId === account.id ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                    默认
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {ACCOUNT_TYPE_LABELS[account.type]} · 余额{" "}
                {formatCents(balances[account.id] ?? 0)}
              </p>
            </button>
            <button
              type="button"
              onClick={() => toggleArchive(account)}
              className="min-h-9 rounded-lg border border-border px-3 text-xs text-muted-foreground"
            >
              归档
            </button>
            {defaultId !== account.id ? (
              <button
                type="button"
                onClick={() => setAsDefault(account)}
                className="min-h-9 rounded-lg border border-border px-3 text-xs text-muted-foreground"
              >
                设默认
              </button>
            ) : null}
          </div>
        ))}
        {archived.map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between gap-2 px-4 py-3 opacity-60"
          >
            <div>
              <p className="text-sm font-medium">{account.name}</p>
              <p className="text-xs text-muted-foreground">
                {ACCOUNT_TYPE_LABELS[account.type]} · 已归档 · 余额{" "}
                {formatCents(balances[account.id] ?? 0)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleArchive(account)}
              className="min-h-9 rounded-lg border border-border px-3 text-xs"
            >
              恢复
            </button>
          </div>
        ))}
        {active.length === 0 && archived.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            还没有账户
          </p>
        ) : null}
      </section>

      <p className="text-xs text-muted-foreground">
        有记录的账户不可删除，只能归档（ACC-04）；归档后不再出现在选择列表。
      </p>
    </main>
  );
}
