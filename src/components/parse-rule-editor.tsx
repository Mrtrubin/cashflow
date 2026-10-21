"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DATE_FORMAT_OPTIONS,
  type ParseRule,
  SCRIPT_FIELDS,
  SCRIPT_TEMPLATE,
  validateRule,
} from "@/lib/parse-rule";

/** 解析规则编辑器：规则就是一段沙箱脚本 */
export function ParseRuleEditor({
  rule,
  sampleLine,
  onSave,
  onCancel,
  onDelete,
}: {
  rule: ParseRule;
  sampleLine: string | null;
  onSave: (rule: ParseRule) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<ParseRule>(rule);
  const issues = validateRule(draft);

  function patch(next: Partial<ParseRule>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {onDelete ? "编辑解析脚本" : "新建解析脚本"}
        </h2>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label="删除规则"
            className="flex items-center gap-1 text-xs text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            删除
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-name">规则名称</Label>
        <Input
          id="rule-name"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="例如：微信账单"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="rule-script">脚本（每行调用一次）</Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => patch({ script: SCRIPT_TEMPLATE })}
              className="text-xs text-primary"
            >
              插入示例
            </button>
            <button
              type="button"
              onClick={() => patch({ script: "" })}
              className="text-xs text-muted-foreground"
            >
              清空
            </button>
          </div>
        </div>
        <textarea
          id="rule-script"
          value={draft.script}
          onChange={(event) => patch({ script: event.target.value })}
          rows={14}
          spellCheck={false}
          placeholder={"// 返回 { date, amount, ... }；返回 null 跳过该行"}
          className="w-full rounded-xl border border-border bg-background p-2 font-mono text-xs leading-relaxed"
        />
        {sampleLine ? (
          <p className="truncate rounded-lg bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
            示例行：{sampleLine}
          </p>
        ) : null}
        <p className="rounded-lg bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
          脚本在隔离的 iframe 沙箱中运行，拿不到本机账本、localStorage
          与登录态；超过 3 秒会强制终止。脚本只保存在本机，不参与云端同步。
        </p>
        <details className="rounded-lg bg-background px-2 py-1.5">
          <summary className="cursor-pointer text-xs font-medium">
            可返回的字段
          </summary>
          <ul className="flex flex-col gap-1 pt-2 text-[11px] text-muted-foreground">
            {SCRIPT_FIELDS.map((item) => (
              <li key={item.field}>
                <code className="font-mono text-foreground">{item.field}</code>
                ：{item.desc}
              </li>
            ))}
          </ul>
          <p className="pt-2 text-[11px] text-muted-foreground">
            可用参数：<code className="font-mono">line</code>（当前行）、
            <code className="font-mono">ctx</code>（accounts / categories /
            defaultAccountId / today）、<code className="font-mono">index</code>
            （从 0 开始）。
          </p>
        </details>
      </div>

      <details className="rounded-lg bg-background px-2 py-1.5">
        <summary className="cursor-pointer text-xs font-medium">
          高级设置
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.skipHeader}
              onChange={(event) => patch({ skipHeader: event.target.checked })}
              className="size-4"
            />
            首行是表头，解析时跳过
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="comment-prefix" className="text-xs">
                注释前缀
              </Label>
              <Input
                id="comment-prefix"
                value={draft.commentPrefix}
                onChange={(event) =>
                  patch({ commentPrefix: event.target.value })
                }
                placeholder="留空表示不识别"
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="date-format" className="text-xs">
                日期写法
              </Label>
              <select
                id="date-format"
                value={draft.dateFormat}
                onChange={(event) =>
                  patch({
                    dateFormat: event.target.value as ParseRule["dateFormat"],
                  })
                }
                className="min-h-9 rounded-lg border border-border bg-background px-1 text-xs"
              >
                {DATE_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}（{option.sample}）
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="category-separator" className="text-xs">
                分类层级分隔符
              </Label>
              <Input
                id="category-separator"
                value={draft.categorySeparator}
                onChange={(event) =>
                  patch({ categorySeparator: event.target.value })
                }
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="transfer-separator" className="text-xs">
                转账账户分隔符
              </Label>
              <Input
                id="transfer-separator"
                value={draft.transferSeparator}
                onChange={(event) =>
                  patch({ transferSeparator: event.target.value })
                }
                className="h-9"
              />
            </div>
          </div>
        </div>
      </details>

      {issues.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-destructive">
          {issues.map((issue) => (
            <li key={issue}>· {issue}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onCancel}
          type="button"
        >
          取消
        </Button>
        <Button
          className="flex-1"
          type="button"
          disabled={issues.length > 0}
          onClick={() => onSave({ ...draft, name: draft.name.trim() })}
        >
          保存规则
        </Button>
      </div>
    </section>
  );
}
