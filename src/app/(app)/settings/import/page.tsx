"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ParseRuleEditor } from "@/components/parse-rule-editor";
import { ScriptPromptPanel } from "@/components/script-prompt-panel";
import { showToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  applyHints,
  type CategoryHints,
  hintKey,
  loadHints,
  saveHints,
} from "@/lib/category-hints";
import { todayISO } from "@/lib/date";
import { getDb } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { createEmptyRule, type ParseRule } from "@/lib/parse-rule";
import {
  deleteRule,
  getActiveRuleId,
  listRules,
  saveRule,
  setActiveRuleId,
} from "@/lib/parse-rule-store";
import {
  buildScriptRow,
  collectLines,
  markDuplicatesAgainstDb,
  markDuplicatesInText,
  type ParsedRow,
} from "@/lib/parse-text";
import {
  createAccount,
  createCategory,
  getDefaultAccountId,
  type ImportRowPlan,
  listAllAccounts,
  listAllCategories,
  listImportBatches,
  listTransactions,
  runImport,
  undoImportBatch,
} from "@/lib/repo";
import { runScriptRule } from "@/lib/script-runner";
import type {
  Account,
  Category,
  ImportBatch,
  Transaction,
  TxKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META = {
  ok: { icon: "✅", label: "可导入" },
  confirm: { icon: "⚠️", label: "需确认" },
  error: { icon: "❌", label: "错误" },
} as const;

type Tab = "import" | "prompt";

type CategoryChoice =
  | { type: "skip" }
  | { type: "existing"; id: string }
  | { type: "new" };
type AccountChoice =
  | { type: "skip" }
  | { type: "existing"; id: string }
  | { type: "new" };
type KindChoice = Extract<TxKind, "income" | "expense">;

export default function ImportPage() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("import");
  const [text, setText] = useState("");
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [activeRuleId, setActiveId] = useState<string | null>(null);
  const [editorRule, setEditorRule] = useState<ParseRule | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parsedBy, setParsedBy] = useState<ParseRule | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [parseInfo, setParseInfo] = useState<{
    headerSkipped: boolean;
    commentCount: number;
    scriptSkipped: number;
  } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [categoryChoices, setCategoryChoices] = useState<
    Record<number, CategoryChoice>
  >({});
  const [accountChoices, setAccountChoices] = useState<
    Record<number, AccountChoice>
  >({});
  const [kindChoices, setKindChoices] = useState<Record<number, KindChoice>>(
    {},
  );
  const [keepDuplicates, setKeepDuplicates] = useState<Record<number, boolean>>(
    {},
  );
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  /** 本机记住的「商户 → 分类」，解析后自动套用 */
  const [hints, setHints] = useState<CategoryHints>({});
  const [hintApplied, setHintApplied] = useState(0);

  useEffect(() => {
    void (async () => {
      await getDb();
      const [
        accountList,
        categoryList,
        txnList,
        batchList,
        defaultId,
        ruleList,
        activeId,
        savedHints,
      ] = await Promise.all([
        listAllAccounts(),
        listAllCategories(),
        listTransactions(),
        listImportBatches(),
        getDefaultAccountId(),
        listRules(),
        getActiveRuleId(),
        loadHints(),
      ]);
      setAccounts(accountList.filter((a) => !a.deletedAt && !a.archived));
      setCategories(categoryList.filter((c) => !c.deletedAt && !c.archived));
      setTxns(txnList);
      setBatches(batchList.filter((b) => !b.deletedAt));
      setDefaultAccountId(defaultId);
      setRules(ruleList);
      setHints(savedHints);
      const active =
        ruleList.find((rule) => rule.id === activeId) ?? ruleList[0] ?? null;
      setActiveId(active?.id ?? null);
      setReady(true);
    })();
  }, []);

  const activeRule = useMemo(
    () => rules.find((rule) => rule.id === activeRuleId) ?? null,
    [rules, activeRuleId],
  );

  const sampleLine = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? null,
    [text],
  );

  function resetPreview() {
    setRows(null);
    setParsedBy(null);
    setParseInfo(null);
    setHintApplied(0);
    setCategoryChoices({});
    setAccountChoices({});
    setKindChoices({});
    setKeepDuplicates({});
  }

  async function parse() {
    if (!text.trim()) {
      showToast("请先粘贴要导入的文本");
      return;
    }
    if (!activeRule) {
      showToast("请先添加解析脚本");
      setTab("prompt");
      return;
    }

    const ctx = { categories, accounts, defaultAccountId, existingTxns: txns };
    const collected = collectLines(text, activeRule);
    setParsing(true);
    try {
      const outcomes = await runScriptRule(
        activeRule.script,
        collected.lines.map((line) => line.raw),
        {
          accounts: accounts.map((account) => ({
            id: account.id,
            name: account.name,
          })),
          categories: categories.map((category) => ({
            id: category.id,
            name: category.name,
            kind: category.kind,
            parentId: category.parentId,
          })),
          defaultAccountId,
          today: todayISO(),
        },
      );

      const parsedRows: ParsedRow[] = [];
      let scriptSkipped = 0;
      outcomes.forEach((outcome, index) => {
        const line = collected.lines[index];
        if (!line) return;
        const row = buildScriptRow(
          line.raw,
          line.lineNo,
          outcome,
          ctx,
          activeRule,
        );
        if (row) parsedRows.push(row);
        else scriptSkipped += 1;
      });

      // 先把记住的「商户 → 分类」套上去，再算重复
      const applied = applyHints(parsedRows, hints, categories);
      markDuplicatesInText(parsedRows);
      markDuplicatesAgainstDb(parsedRows, txns);

      setRows(parsedRows);
      setParsedBy(activeRule);
      setHintApplied(applied);
      setTruncated(collected.truncated);
      setParseInfo({
        headerSkipped: collected.headerSkipped,
        commentCount: collected.commentCount,
        scriptSkipped,
      });
      setCategoryChoices({});
      setAccountChoices({});
      setKindChoices({});
      setKeepDuplicates({});

      if (parsedRows.length === 0) {
        showToast("脚本没有返回任何记录，检查脚本或文本格式");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "解析失败");
    } finally {
      setParsing(false);
    }
  }

  const plans = useMemo((): ImportRowPlan[] | null => {
    if (!rows) return null;
    return rows.map((row) => {
      const kind = row.kind ?? kindChoices[row.lineNo] ?? null;
      const catChoice = categoryChoices[row.lineNo];
      const accChoice = accountChoices[row.lineNo];
      const isImportable = row.status !== "error" && kind !== null;
      const isDuplicate = row.duplicateOf !== null;
      // 用户在预览里选了「不导入该行」
      const skipped = catChoice?.type === "skip";
      const categoryId =
        skipped || kind === "transfer"
          ? null
          : ((catChoice?.type === "existing" ? catChoice.id : null) ??
            row.categoryId);
      const needsCategoryMap =
        kind !== "transfer" && !categoryId && catChoice?.type !== "new";
      const needsAccountMap =
        !row.accountIds[0] &&
        accChoice?.type !== "existing" &&
        accChoice?.type !== "new";
      // 转账必须有转入账户，脚本没给出时不允许导入
      const transferWithoutTarget = kind === "transfer" && !row.accountIds[1];
      const keep =
        isImportable &&
        !skipped &&
        !transferWithoutTarget &&
        (!isDuplicate || (keepDuplicates[row.lineNo] ?? false)) &&
        !needsCategoryMap &&
        !needsAccountMap;
      const accountId =
        row.accountIds[0] ??
        (accChoice?.type === "existing" ? accChoice.id : defaultAccountId);
      return {
        row: kind ? { ...row, kind } : row,
        categoryId,
        accountId,
        toAccountId: row.accountIds[1],
        keep,
      };
    });
  }, [
    rows,
    keepDuplicates,
    categoryChoices,
    accountChoices,
    kindChoices,
    defaultAccountId,
  ]);

  const pendingCount = useMemo(() => {
    if (!plans) return { imported: 0, skipped: 0, failed: 0 };
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    for (const plan of plans) {
      if (plan.row.status === "error") failed += 1;
      else if (plan.keep) imported += 1;
      else skipped += 1;
    }
    return { imported, skipped, failed };
  }, [plans]);

  /** 分类仍是兜底「其他」的行数：导入前提醒用户指定 */
  const otherCount = useMemo(() => {
    if (!plans) return 0;
    const otherIds = new Set(
      categories.filter((c) => c.name === "其他").map((c) => c.id),
    );
    return plans.filter(
      (plan) => plan.categoryId !== null && otherIds.has(plan.categoryId),
    ).length;
  }, [plans, categories]);

  async function handleImport() {
    if (!plans || importing) return;
    if (pendingCount.imported === 0) {
      showToast("没有可导入的记录");
      return;
    }
    setImporting(true);
    try {
      const createdCategoryId = new Map<number, string>();
      const createdAccountId = new Map<number, string>();
      for (const row of rows ?? []) {
        const catChoice = categoryChoices[row.lineNo];
        if (catChoice?.type === "new" && row.categoryPath) {
          const category = await createCategory({
            name: row.categoryPath[0],
            kind:
              (row.kind ?? kindChoices[row.lineNo]) === "income"
                ? "income"
                : "expense",
            parentId: null,
            icon: "📦",
            color: "#94a3b8",
            archived: false,
          });
          createdCategoryId.set(row.lineNo, category.id);
        }
        const accChoice = accountChoices[row.lineNo];
        if (accChoice?.type === "new" && row.accountsPath?.[0]) {
          const account = await createAccount({
            name: row.accountsPath[0],
            type: "other",
            openingBalance: 0,
            archived: false,
          });
          createdAccountId.set(row.lineNo, account.id);
        }
      }

      const finalPlans: ImportRowPlan[] = plans.map((plan) => ({
        ...plan,
        categoryId:
          plan.categoryId ?? createdCategoryId.get(plan.row.lineNo) ?? null,
        accountId:
          plan.accountId ?? createdAccountId.get(plan.row.lineNo) ?? null,
      }));

      // 记住这次手动指定的分类：下次同样的商户直接套用（IMP-09）
      const hintPatch: Record<string, string> = {};
      for (const plan of finalPlans) {
        const choice = categoryChoices[plan.row.lineNo];
        if (choice?.type !== "existing" && choice?.type !== "new") continue;
        const key = hintKey(plan.row.note);
        if (!key || !plan.categoryId) continue;
        hintPatch[key] = plan.categoryId;
      }
      const remembered = Object.keys(hintPatch).length;
      if (remembered > 0) {
        await saveHints(hintPatch);
        setHints(await loadHints());
      }

      const result = await runImport("text", finalPlans);
      setLastResult(
        `成功导入 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条${
          remembered > 0 ? `；已记住 ${remembered} 个商户的分类` : ""
        }`,
      );
      showToast(`已导入 ${result.imported} 条记录`, {
        label: "撤销",
        run: async () => {
          await undoImportBatch(result.batchId);
          showToast("已撤销本次导入");
        },
      });

      const [txnList, batchList] = await Promise.all([
        listTransactions(),
        listImportBatches(),
      ]);
      setTxns(txnList);
      setBatches(batchList.filter((b) => !b.deletedAt));
      resetPreview();
      setText("");
    } catch {
      showToast("导入失败，请重试");
    } finally {
      setImporting(false);
    }
  }

  async function handleUndo(batchId: string) {
    if (!window.confirm("撤销后该批次的全部记录将被删除，确认？")) return;
    const count = await undoImportBatch(batchId);
    showToast(`已撤销 ${count} 条记录`);
    setBatches((current) =>
      current.map((b) =>
        b.id === batchId ? { ...b, deletedAt: new Date().toISOString() } : b,
      ),
    );
    const txnList = await listTransactions();
    setTxns(txnList);
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file, "utf-8");
  }

  function startCreateRule() {
    setEditorRule(createEmptyRule(`脚本 ${rules.length + 1}`));
  }

  async function handleSaveRule(rule: ParseRule) {
    const saved = await saveRule(rule);
    setRules(await listRules());
    setActiveId(saved.id);
    setEditorRule(null);
    resetPreview();
    showToast(`已保存脚本「${saved.name}」`);
  }

  async function handleDeleteRule(rule: ParseRule) {
    if (!window.confirm(`删除规则「${rule.name}」？已导入的记录不受影响。`)) {
      return;
    }
    await deleteRule(rule.id);
    const nextRules = await listRules();
    setRules(nextRules);
    const nextActive =
      nextRules.find((item) => item.id === activeRuleId) ??
      nextRules[0] ??
      null;
    setActiveId(nextActive?.id ?? null);
    setEditorRule(null);
    resetPreview();
    showToast("已删除规则");
  }

  async function handleSelectRule(id: string) {
    setActiveId(id);
    await setActiveRuleId(id);
    resetPreview();
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        加载中…
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-6">
      <header>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            aria-label="返回"
            className="flex size-10 items-center justify-center rounded-full"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="text-xl font-semibold">文本导入</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          没有内置格式：解析规则是一段 JS 脚本，可以自己写，也可以让 AI 生成。
        </p>
      </header>

      <div
        role="tablist"
        aria-label="文本导入"
        className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "import"}
          onClick={() => setTab("import")}
          className={cn(
            "min-h-9 rounded-lg text-sm",
            tab === "import"
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground",
          )}
        >
          导入
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "prompt"}
          onClick={() => setTab("prompt")}
          className={cn(
            "min-h-9 rounded-lg text-sm",
            tab === "prompt"
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground",
          )}
        >
          生成脚本
        </button>
      </div>

      {tab === "prompt" ? (
        <ScriptPromptPanel
          text={text}
          onTextChange={setText}
          accounts={accounts}
          categories={categories}
          ruleCount={rules.length}
          onSaved={async (rule) => {
            setRules(await listRules());
            setActiveId(rule.id);
            resetPreview();
            setTab("import");
          }}
        />
      ) : editorRule ? (
        <ParseRuleEditor
          rule={editorRule}
          sampleLine={sampleLine}
          onSave={handleSaveRule}
          onCancel={() => setEditorRule(null)}
          onDelete={
            rules.some((rule) => rule.id === editorRule.id)
              ? () => handleDeleteRule(editorRule)
              : undefined
          }
        />
      ) : (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                解析脚本
              </span>
              <button
                type="button"
                onClick={startCreateRule}
                className="text-xs text-primary"
              >
                + 新建脚本
              </button>
            </div>

            {activeRule ? (
              <div className="flex items-center gap-2">
                <select
                  value={activeRule.id}
                  onChange={(event) => handleSelectRule(event.target.value)}
                  aria-label="选择解析脚本"
                  className="min-h-10 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
                >
                  {rules.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setEditorRule(activeRule)}
                  className="min-h-10 rounded-lg border border-border px-3 text-xs"
                >
                  编辑
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-3">
                <p className="text-sm">还没有解析脚本，添加后才能解析文本。</p>
                <p className="text-xs text-muted-foreground">
                  最快的方式：用「生成脚本」把账单文本发给
                  AI，把返回的脚本粘贴回来。
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={() => setTab("prompt")}
                  >
                    用 AI 生成
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={startCreateRule}
                  >
                    自己写
                  </Button>
                </div>
              </div>
            )}
          </section>

          {rows === null ? (
            <section className="flex flex-col gap-3">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="粘贴账单文本，每行一条记录"
                rows={10}
                className="w-full rounded-xl border border-border bg-background p-3 font-mono text-sm"
                aria-label="粘贴账单文本"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={parse}
                  className="min-h-11 flex-1 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-40"
                  disabled={!activeRule || parsing}
                >
                  {parsing ? "解析中…" : "解析预览"}
                </button>
                <label className="flex min-h-11 items-center rounded-xl border border-border px-4 text-sm">
                  选择文件
                  <input
                    type="file"
                    accept=".txt,.csv,text/plain,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleFile(file);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              {!activeRule ? (
                <p className="text-xs text-muted-foreground">
                  还没有解析脚本，解析按钮暂不可用。
                </p>
              ) : null}
            </section>
          ) : (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  预览（{rows.length} 行）
                  {parsedBy ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {parsedBy.name}
                    </span>
                  ) : null}
                </h2>
                <button
                  type="button"
                  className="text-xs text-muted-foreground"
                  onClick={resetPreview}
                >
                  重新编辑文本
                </button>
              </div>
              {truncated ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  超过 2000 行，仅解析前 2000 行，请分批导入
                </p>
              ) : null}
              {parseInfo?.headerSkipped ||
              (parseInfo?.commentCount ?? 0) > 0 ||
              (parseInfo?.scriptSkipped ?? 0) > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {parseInfo?.headerSkipped ? "已跳过首行（表头）" : ""}
                  {parseInfo?.headerSkipped &&
                  (parseInfo?.commentCount ?? 0) > 0
                    ? " · "
                    : ""}
                  {(parseInfo?.commentCount ?? 0) > 0
                    ? `已忽略 ${parseInfo?.commentCount} 行注释`
                    : ""}
                  {(parseInfo?.scriptSkipped ?? 0) > 0
                    ? `${parseInfo?.scriptSkipped} 行被脚本跳过`
                    : ""}
                </p>
              ) : null}

              {hintApplied > 0 ? (
                <p className="text-xs text-muted-foreground">
                  已按记忆套用 {hintApplied} 行分类
                </p>
              ) : null}

              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>✅ {pendingCount.imported} 可导入</span>
                <span>⚠️ {pendingCount.skipped} 需确认/跳过</span>
                <span>❌ {pendingCount.failed} 错误</span>
              </div>

              {otherCount > 0 ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {otherCount}{" "}
                  行分类是兜底「其他」，导入前建议逐行指定；指定过的商户会记住，下次自动套用。
                </p>
              ) : null}

              <div className="flex flex-col divide-y divide-border/60 rounded-xl border border-border">
                {rows.map((row, index) => (
                  <PreviewRow
                    key={row.lineNo}
                    row={row}
                    willImport={plans?.[index]?.keep ?? false}
                    categories={categories}
                    accounts={accounts}
                    defaultAccountId={defaultAccountId}
                    categoryChoice={categoryChoices[row.lineNo]}
                    accountChoice={accountChoices[row.lineNo]}
                    kindChoice={kindChoices[row.lineNo]}
                    keepDuplicate={keepDuplicates[row.lineNo] ?? false}
                    onCategoryChoice={(choice) =>
                      setCategoryChoices((current) => ({
                        ...current,
                        [row.lineNo]: choice,
                      }))
                    }
                    onAccountChoice={(choice) =>
                      setAccountChoices((current) => ({
                        ...current,
                        [row.lineNo]: choice,
                      }))
                    }
                    onKindChoice={(kind) =>
                      setKindChoices((current) => ({
                        ...current,
                        [row.lineNo]: kind,
                      }))
                    }
                    onKeepDuplicate={(keep) =>
                      setKeepDuplicates((current) => ({
                        ...current,
                        [row.lineNo]: keep,
                      }))
                    }
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={handleImport}
                disabled={importing || pendingCount.imported === 0}
                className="min-h-11 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-40"
              >
                {importing ? "导入中…" : `导入 ${pendingCount.imported} 条`}
              </button>
            </section>
          )}

          {lastResult ? (
            <p
              aria-live="polite"
              className="rounded-xl bg-muted/60 px-3 py-2 text-sm"
            >
              {lastResult}
            </p>
          ) : null}

          {/* 导入历史与整批撤销（IMP-06） */}
          <section aria-label="导入历史">
            <h2 className="pb-1 text-sm font-semibold text-muted-foreground">
              导入历史
            </h2>
            {batches.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">暂无导入记录</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/60">
                {batches.map((batch) => (
                  <li
                    key={batch.id}
                    className="flex min-h-12 items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">
                        {batch.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                        {batch.source === "text" ? "文本" : "CSV"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        成功 {batch.imported} · 跳过 {batch.skipped} · 失败{" "}
                        {batch.failed}
                      </p>
                    </div>
                    {batch.deletedAt ? (
                      <span className="text-xs text-muted-foreground">
                        已撤销
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUndo(batch.id)}
                        className="min-h-9 rounded-lg border border-destructive/40 px-3 text-xs text-destructive"
                      >
                        撤销批次
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

/** 用户已经在预览里补齐的字段，不再显示对应提示 */
function visibleReasons(
  row: ParsedRow,
  kindChoice: KindChoice | undefined,
  categoryChoice: CategoryChoice | undefined,
  accountChoice: AccountChoice | undefined,
): string[] {
  return row.reasons.filter((reason) => {
    if (
      kindChoice &&
      (reason.startsWith("脚本没有给出类型") || reason === "类型无法推断")
    ) {
      return false;
    }
    if (
      categoryChoice &&
      categoryChoice.type !== "skip" &&
      reason.startsWith("脚本没有给出分类")
    ) {
      return false;
    }
    if (
      accountChoice &&
      accountChoice.type !== "skip" &&
      (reason.startsWith("脚本没有给出账户") ||
        reason.startsWith("账户「") ||
        reason.startsWith("转出账户") ||
        reason.startsWith("转入账户"))
    ) {
      return false;
    }
    return true;
  });
}

function formatCategoryPath(path: [string, string | null] | null): string {
  if (!path) return "无分类";
  return path[1] ? `${path[0]}/${path[1]}` : path[0];
}

function PreviewRow({
  row,
  willImport,
  categories,
  accounts,
  defaultAccountId,
  categoryChoice,
  accountChoice,
  kindChoice,
  keepDuplicate,
  onCategoryChoice,
  onAccountChoice,
  onKindChoice,
  onKeepDuplicate,
}: {
  row: ParsedRow;
  willImport: boolean;
  categories: Category[];
  accounts: Account[];
  defaultAccountId: string | null;
  categoryChoice?: CategoryChoice;
  accountChoice?: AccountChoice;
  kindChoice?: KindChoice;
  keepDuplicate: boolean;
  onCategoryChoice: (choice: CategoryChoice) => void;
  onAccountChoice: (choice: AccountChoice) => void;
  onKindChoice: (kind: KindChoice) => void;
  onKeepDuplicate: (keep: boolean) => void;
}) {
  // 图标反映最终结果：已补齐/已保留的行显示为可导入
  const displayStatus =
    row.status === "error" ? "error" : willImport ? "ok" : "confirm";
  const meta = STATUS_META[displayStatus];
  const kind = row.kind ?? kindChoice ?? null;
  const needsKind = row.status !== "error" && row.kind === null;
  const isFallbackOther =
    row.categoryId !== null &&
    categories.find((category) => category.id === row.categoryId)?.name ===
      "其他";
  // 分类是兜底「其他」时也把下拉露出来，提醒用户改（改完会记住）
  const needsCategory =
    row.status !== "error" &&
    kind !== "transfer" &&
    (!row.categoryId || isFallbackOther);
  const needsAccount =
    row.status !== "error" && kind !== null && !row.accountIds[0];
  const kindLabel =
    kind === "income"
      ? "收入"
      : kind === "expense"
        ? "支出"
        : kind === "transfer"
          ? "转账"
          : "类型?";
  const defaultAccountName = accounts.find(
    (account) => account.id === defaultAccountId,
  )?.name;
  const reasons = visibleReasons(
    row,
    kindChoice,
    categoryChoice,
    accountChoice,
  );

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-start gap-2 text-sm">
        <span aria-hidden="true" className="pt-0.5">
          {meta.icon}
        </span>
        <span className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums">
          {row.lineNo}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap gap-x-2">
            <span>{row.date ?? "日期?"}</span>
            {row.time ? (
              <span className="text-muted-foreground">{row.time}</span>
            ) : null}
            <span className={cn(!kind && "text-destructive")}>{kindLabel}</span>
            <span className="font-medium tabular-nums">
              {row.amountCents === null
                ? "金额?"
                : formatCents(row.amountCents)}
            </span>
            <span className="text-muted-foreground">
              {kind === "transfer"
                ? `${row.accountsPath?.[0] ?? "?"}>${row.accountsPath?.[1] ?? "?"}`
                : formatCategoryPath(row.categoryPath)}
            </span>
            {row.note ? (
              <span className="text-muted-foreground">{row.note}</span>
            ) : null}
          </span>

          {row.kindSource === "category" ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              类型按分类推断
            </span>
          ) : null}
          {row.categoryFromHint ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              分类按记忆套用
            </span>
          ) : null}
          {isFallbackOther && !categoryChoice ? (
            <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">
              分类是兜底「其他」，导入前建议指定（会记住，下次自动套用）
            </span>
          ) : null}
          {row.accountSource === "default" ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              账户使用默认
              {defaultAccountName ? `「${defaultAccountName}」` : "账户"}
            </span>
          ) : null}

          {reasons.length > 0 ? (
            <span className="mt-0.5 block text-xs text-destructive">
              {reasons.join("；")}
            </span>
          ) : null}
        </span>
        {row.duplicateOf && row.status !== "error" ? (
          <label className="flex shrink-0 items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={keepDuplicate}
              onChange={(event) => onKeepDuplicate(event.target.checked)}
              className="size-4"
            />
            保留
          </label>
        ) : null}
      </div>

      {needsKind ? (
        <div className="flex items-center gap-2 pl-14">
          <span className="text-xs text-muted-foreground">类型</span>
          <select
            value={kindChoice ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "income" || value === "expense") {
                onKindChoice(value);
              }
            }}
            aria-label={`第 ${row.lineNo} 行的类型`}
            className={cn(
              "min-h-8 flex-1 rounded-lg border border-border bg-background px-1 text-xs",
              !kindChoice && "border-destructive/50",
            )}
          >
            <option value="">请选择（脚本没有给出类型）</option>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </div>
      ) : null}

      {needsCategory ? (
        <div className="flex items-center gap-2 pl-14">
          <span className="text-xs text-muted-foreground">分类</span>
          <select
            value={
              categoryChoice
                ? categoryChoice.type === "existing"
                  ? categoryChoice.id
                  : categoryChoice.type === "skip"
                    ? ""
                    : "new"
                : (row.categoryId ?? "")
            }
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return onCategoryChoice({ type: "skip" });
              if (value === "new") return onCategoryChoice({ type: "new" });
              onCategoryChoice({ type: "existing", id: value });
            }}
            aria-label={`第 ${row.lineNo} 行的分类`}
            className={cn(
              "min-h-8 flex-1 rounded-lg border border-border bg-background px-1 text-xs",
              !row.categoryId && !categoryChoice && "border-destructive/50",
              isFallbackOther && !categoryChoice && "border-amber-500/60",
            )}
          >
            <option value="">不导入该行</option>
            {categories
              .filter((c) => c.parentId === null)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.icon} {category.name}
                  {category.kind === "income" ? "（收入）" : ""}
                </option>
              ))}
            {!row.categoryId && row.categoryPath ? (
              <option value="new">新建一级分类「{row.categoryPath[0]}」</option>
            ) : null}
          </select>
        </div>
      ) : null}

      {needsAccount ? (
        <div className="flex items-center gap-2 pl-14">
          <span className="text-xs text-muted-foreground">账户</span>
          <select
            value={
              accountChoice
                ? accountChoice.type === "existing"
                  ? accountChoice.id
                  : accountChoice.type
                : ""
            }
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return onAccountChoice({ type: "skip" });
              if (value === "new") return onAccountChoice({ type: "new" });
              onAccountChoice({ type: "existing", id: value });
            }}
            aria-label={`第 ${row.lineNo} 行的账户`}
            className={cn(
              "min-h-8 flex-1 rounded-lg border border-border bg-background px-1 text-xs",
              !accountChoice && !defaultAccountId && "border-destructive/50",
            )}
          >
            <option value="">不导入该行</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            {row.accountsPath?.[0] ? (
              <option value="new">新建账户「{row.accountsPath[0]}」</option>
            ) : null}
          </select>
        </div>
      ) : null}
    </div>
  );
}
