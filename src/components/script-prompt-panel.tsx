"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";
import { showToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayISO } from "@/lib/date";
import {
  createEmptyRule,
  extractScript,
  type ParseRule,
} from "@/lib/parse-rule";
import { saveRule } from "@/lib/parse-rule-store";
import { buildScriptPrompt, SCRIPT_SYSTEM_PROMPT } from "@/lib/script-prompt";
import type { Account, Category } from "@/lib/types";

/**
 * 「生成脚本」标签页：
 * 把系统提示词 + 当前账本 + 用户粘贴的账单文本拼成一段提示词，
 * 复制给任意 AI 生成脚本，再把脚本粘贴回来保存为解析规则。
 */
export function ScriptPromptPanel({
  text,
  onTextChange,
  accounts,
  categories,
  ruleCount,
  onSaved,
}: {
  text: string;
  onTextChange: (value: string) => void;
  accounts: Account[];
  categories: Category[];
  ruleCount: number;
  onSaved: (rule: ParseRule) => void;
}) {
  const [scriptInput, setScriptInput] = useState("");
  const [ruleName, setRuleName] = useState(`AI 脚本 ${ruleCount + 1}`);
  const [saving, setSaving] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const prompt = useMemo(
    () =>
      buildScriptPrompt({
        text,
        accounts,
        categories,
        today: todayISO(),
      }),
    [text, accounts, categories],
  );

  const extracted = extractScript(scriptInput);

  async function handleCopy() {
    if (!text.trim()) {
      showToast("请先粘贴账单文本");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("提示词已复制，去找 AI 生成脚本吧");
    } catch {
      // 剪贴板不可用时退化为选中文本
      promptRef.current?.focus();
      promptRef.current?.select();
      showToast("已选中提示词，请按 ⌘C 复制");
    }
  }

  async function handleSave() {
    if (!extracted) {
      showToast("请先粘贴 AI 返回的脚本");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRule(
        createEmptyRule(
          ruleName.trim() || `AI 脚本 ${ruleCount + 1}`,
          extracted,
        ),
      );
      showToast(`已保存脚本「${saved.name}」`);
      setScriptInput("");
      onSaved(saved);
    } catch {
      showToast("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Step index={1} title="粘贴账单文本">
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          rows={6}
          placeholder="把要导入的账单文本粘贴到这里（会一起放进提示词）"
          className="w-full rounded-xl border border-border bg-background p-3 font-mono text-sm"
          aria-label="账单文本"
        />
        <p className="text-[11px] text-muted-foreground">
          建议粘贴 5–20 行有代表性的内容，包含日期、金额、分类、账户等字段。
        </p>
      </Step>

      <Step index={2} title="复制提示词">
        <textarea
          ref={promptRef}
          value={prompt}
          readOnly
          rows={10}
          className="w-full rounded-xl border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed"
          aria-label="生成解析脚本的提示词"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            onClick={handleCopy}
            disabled={!text.trim()}
          >
            复制提示词
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              promptRef.current?.focus();
              promptRef.current?.select();
            }}
          >
            全选
          </Button>
        </div>
        <details className="rounded-lg bg-muted/40 px-2 py-1.5">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            提示词里写了什么
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
            {SCRIPT_SYSTEM_PROMPT}
          </pre>
        </details>
      </Step>

      <Step index={3} title="粘贴 AI 返回的脚本">
        <textarea
          value={scriptInput}
          onChange={(event) => setScriptInput(event.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={"把 AI 回复的脚本整段粘贴进来（会自动去掉 ```js 围栏）"}
          className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs leading-relaxed"
          aria-label="AI 返回的脚本"
        />
        {scriptInput.trim() ? (
          <p className="text-[11px] text-muted-foreground">
            已识别 {extracted.split("\n").length} 行脚本
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="script-rule-name" className="text-xs">
            规则名称
          </Label>
          <Input
            id="script-rule-name"
            value={ruleName}
            onChange={(event) => setRuleName(event.target.value)}
            className="h-10"
          />
        </div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving || !extracted}
        >
          {saving ? "保存中…" : "保存为规则并去导入"}
        </Button>
      </Step>
    </div>
  );
}

function Step({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">
          {index}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
