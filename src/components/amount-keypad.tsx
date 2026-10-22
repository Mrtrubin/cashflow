"use client";

import { Delete } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { evalExpressionCents } from "@/lib/money";
import { cn } from "@/lib/utils";

interface AmountKeypadProps {
  expression: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}

const KEYS = [
  "7",
  "8",
  "9",
  "÷",
  "4",
  "5",
  "6",
  "×",
  "1",
  "2",
  "3",
  "-",
  ".",
  "0",
  "+",
] as const;

/** 金额键盘：数字、小数点（最多 2 位）、+ − × ÷，运算结果实时预览 */
export function AmountKeypad({
  expression,
  onChange,
  onSubmit,
}: AmountKeypadProps) {
  const evaluated = useMemo(
    () => evalExpressionCents(expression),
    [expression],
  );
  const canSave = evaluated !== null;
  const displayRef = useRef<HTMLSpanElement>(null);

  // 金额右对齐：表达式超长时滚到最右端，保证刚输入的数字始终可见。
  // 不传依赖数组：每次渲染后对齐一次，代价只有一次属性赋值。
  useEffect(() => {
    const el = displayRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  });

  function press(key: (typeof KEYS)[number]) {
    const isOperator = isOperatorChar(key);
    const lastChar = expression.slice(-1);

    if (isOperator) {
      if (!expression) return; // 不能以运算符开头
      // 连续运算符：替换最后一个
      onChange(
        isOperatorChar(lastChar)
          ? expression.slice(0, -1) + key
          : expression + key,
      );
      return;
    }

    if (key === ".") {
      const currentNumber = expression.split(/[+\-×÷]/).pop() ?? "";
      if (currentNumber.includes(".")) return; // 每个数最多一个小数点
      if (!currentNumber) {
        onChange(`${expression}0.`);
        return;
      }
    } else {
      const currentNumber = expression.split(/[+\-×÷]/).pop() ?? "";
      const [, decimals = ""] = currentNumber.split(".");
      if (currentNumber.includes(".") && decimals.length >= 2) return; // 最多 2 位小数
      if (currentNumber.replace(".", "").length >= 9) return;
    }

    onChange(expression + key);
  }

  function backspace() {
    onChange(expression.slice(0, -1));
  }

  function clear() {
    onChange("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-16 flex-col items-end justify-center gap-1 rounded-xl bg-muted px-4 py-2 text-right">
        <span
          ref={displayRef}
          className="w-full overflow-x-auto whitespace-nowrap text-right text-3xl font-semibold tabular-nums [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {expression || "0"}
        </span>
        {expression && isOperatorChar(expression.slice(-1)) ? null : (
          <span className="text-sm text-muted-foreground tabular-nums">
            {evaluated === null && expression
              ? "表达式无效"
              : `= ${((evaluated ?? 0) / 100).toFixed(2)}`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            tabIndex={-1}
            aria-label={key}
            onClick={() => press(key)}
            className={cn(
              "h-12 rounded-xl bg-muted text-xl font-medium text-foreground transition-colors active:bg-accent",
              isOperatorChar(key) && "bg-accent/60",
            )}
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          aria-label="退格"
          onClick={backspace}
          className="flex h-12 items-center justify-center rounded-xl bg-accent/60 text-foreground transition-colors active:bg-accent"
        >
          <Delete className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          tabIndex={-1}
          onClick={clear}
          className="h-12 rounded-xl bg-muted text-base text-muted-foreground transition-colors active:bg-accent"
        >
          清空
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSave}
          className="col-span-3 h-12 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </div>
  );
}

function isOperatorChar(char: string): boolean {
  return ["+", "-", "×", "÷"].includes(char);
}
