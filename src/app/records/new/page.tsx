"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AmountKeypad } from "@/components/amount-keypad";
import { CategoryPicker, categoryLabel } from "@/components/category-picker";
import { showToast } from "@/components/toast";
import { shiftDaysISO, todayISO } from "@/lib/date";
import { evalExpressionCents, formatCents } from "@/lib/money";
import {
  createTransaction,
  findLastUsage,
  getDefaultAccountId,
  getTransaction,
  listAccounts,
  listCategories,
  listRecentTransactions,
  restoreTransaction,
  softDeleteTransaction,
  type TxnInput,
  updateTransaction,
} from "@/lib/repo";
import type { Account, Category, TxKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_TABS: Array<{ kind: TxKind; label: string }> = [
  { kind: "expense", label: "支出" },
  { kind: "income", label: "收入" },
  { kind: "transfer", label: "转账" },
];

export default function NewRecordPage() {
  return (
    <Suspense fallback={null}>
      <TransactionForm />
    </Suspense>
  );
}

function TransactionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");

  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<TxKind>("expense");
  const [expression, setExpression] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [note, setNote] = useState("");
  const [payee, setPayee] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [accountList, categoryList, recentTxns] = await Promise.all([
        listAccounts(),
        listCategories(),
        listRecentTransactions(20),
      ]);
      setAccounts(accountList);
      setCategories(categoryList);
      const seen: string[] = [];
      for (const txn of recentTxns) {
        if (txn.categoryId && !seen.includes(txn.categoryId))
          seen.push(txn.categoryId);
      }
      setRecentIds(seen);
      const defaultId = await getDefaultAccountId();

      if (editId) {
        const txn = await getTransaction(editId);
        if (txn && !txn.deletedAt) {
          setEditing(true);
          setKind(txn.kind);
          setExpression((txn.amount / 100).toFixed(2));
          setCategoryId(txn.categoryId);
          setAccountId(txn.accountId);
          setToAccountId(txn.toAccountId);
          setOccurredOn(txn.occurredOn);
          setNote(txn.note ?? "");
          setPayee(txn.payee ?? "");
        }
      } else {
        setAccountId(defaultId ?? accountList[0]?.id ?? null);
      }
      setLoaded(true);
    })();
  }, [editId]);

  const amountCents = useMemo(
    () => evalExpressionCents(expression),
    [expression],
  );

  const selectedLabel = categoryLabel(categoryId, categories);

  // 备注记忆（REC-05）：命中历史备注/商户时自动填入上次使用的分类
  async function handleNoteBlur() {
    const text = note.trim() || payee.trim();
    if (!text || categoryId) return;
    const usage = await findLastUsage(text);
    if (!usage) return;
    if (kind !== "transfer" && usage.kind !== kind) setKind(usage.kind);
    const valid =
      usage.categoryId &&
      categories.some(
        (c) => c.id === usage.categoryId && c.kind === usage.kind,
      );
    if (valid) setCategoryId(usage.categoryId);
  }

  function validate(): string | null {
    if (amountCents === null) return "请输入有效金额";
    if (kind !== "transfer" && !categoryId) return "请选择分类";
    if (!accountId) return "请选择账户";
    if (kind === "transfer" && (!toAccountId || toAccountId === accountId)) {
      return "转出与转入账户不能相同";
    }
    return null;
  }

  async function handleSave() {
    const error = validate();
    if (error) {
      showToast(error);
      return;
    }
    if (saving) return;
    setSaving(true);
    const input: TxnInput = {
      kind,
      amount: amountCents as number,
      occurredOn,
      occurredAt: null,
      categoryId: kind === "transfer" ? null : categoryId,
      accountId: accountId as string,
      toAccountId: kind === "transfer" ? toAccountId : null,
      payee: payee.trim() || null,
      note: note.trim() || null,
      tags: [],
    };
    try {
      if (editing && editId) {
        await updateTransaction(editId, input);
        showToast("已保存修改");
      } else {
        const txn = await createTransaction(input);
        showToast(`已记账 ¥${formatCents(txn.amount)}`, {
          label: "撤销",
          run: () => softDeleteTransaction(txn.id),
        });
      }
      router.back();
    } catch {
      showToast("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editId || !window.confirm("确认删除这条记录？")) return;
    await softDeleteTransaction(editId);
    showToast("已删除记录", {
      label: "撤销",
      run: () => restoreTransaction(editId),
    });
    router.back();
  }

  if (!loaded) {
    return (
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        加载中…
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-4 pt-3">
      <header className="flex items-center justify-between pb-3">
        <button
          type="button"
          aria-label="返回"
          onClick={() => router.back()}
          className="flex size-10 items-center justify-center rounded-full text-foreground"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <div
          className="flex rounded-full bg-muted p-1"
          role="tablist"
          aria-label="记录类型"
        >
          {KIND_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={kind === tab.kind}
              onClick={() => {
                setKind(tab.kind);
                if (tab.kind === "transfer") {
                  const first = accounts.find((a) => a.id !== accountId);
                  if (!toAccountId || toAccountId === accountId)
                    setToAccountId(first?.id ?? null);
                }
              }}
              className={cn(
                "min-h-9 rounded-full px-4 text-sm font-medium transition-colors",
                kind === tab.kind
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {editing ? (
          <button
            type="button"
            onClick={handleDelete}
            className="min-h-10 px-2 text-sm text-destructive"
          >
            删除
          </button>
        ) : (
          <span className="size-10" />
        )}
      </header>

      <div className="flex flex-col gap-3 pb-4">
        <AmountKeypad
          expression={expression}
          onChange={setExpression}
          onSubmit={handleSave}
        />

        {kind !== "transfer" ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-left text-sm",
              !selectedLabel && "text-muted-foreground",
            )}
          >
            <span aria-hidden="true">{selectedLabel?.icon ?? "🏷️"}</span>
            <span className={cn(!selectedLabel && "text-muted-foreground")}>
              {selectedLabel?.name ?? "选择分类（必填）"}
            </span>
          </button>
        ) : null}

        {kind === "transfer" ? (
          <div className="grid grid-cols-2 gap-2">
            <AccountSelect
              label="转出账户"
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
            />
            <AccountSelect
              label="转入账户"
              accounts={accounts}
              value={toAccountId}
              onChange={setToAccountId}
            />
          </div>
        ) : (
          <AccountSelect
            label="账户"
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
          />
        )}

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
            className="min-h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
            aria-label="日期"
          />
          <button
            type="button"
            onClick={() => setOccurredOn(shiftDaysISO(todayISO(), -1))}
            className="min-h-11 rounded-xl bg-muted px-4 text-sm text-foreground"
          >
            昨天
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={handleNoteBlur}
            placeholder="备注"
            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm"
          />
          <input
            type="text"
            value={payee}
            onChange={(event) => setPayee(event.target.value)}
            onBlur={handleNoteBlur}
            placeholder="商户（选填）"
            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm"
          />
        </div>
      </div>

      <CategoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={categories}
        kind={kind === "income" ? "income" : "expense"}
        recentIds={recentIds}
        value={categoryId}
        onSelect={setCategoryId}
      />
    </main>
  );
}

function AccountSelect({
  label,
  accounts,
  value,
  onChange,
}: {
  label: string;
  accounts: Account[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-xl border border-border bg-background px-2 text-sm text-foreground"
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
    </label>
  );
}
