"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { showToast } from "@/components/toast";
import { getDb } from "@/lib/db";
import { createCategory, listCategories, updateCategory } from "@/lib/repo";
import type { Category, CategoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICON_OPTIONS = [
  "🍜",
  "🚇",
  "🛍️",
  "🏠",
  "🎮",
  "💊",
  "📚",
  "🎁",
  "📦",
  "💼",
  "💰",
  "🧑‍💻",
  "📥",
  "⭐",
];
const COLOR_OPTIONS = [
  "#f97316",
  "#3b82f6",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#ef4444",
  "#14b8a6",
  "#eab308",
  "#94a3b8",
  "#22c55e",
];

/** 分类列表（含已归档），放在组件外，避免成为 effect 依赖 */
async function fetchCategories(): Promise<Category[]> {
  await getDb();
  return listCategories(true);
}

export default function CategoriesSettingsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string | null;
    parentId: string | null;
  } | null>(null);
  const [form, setForm] = useState({
    name: "",
    icon: "📦",
    color: COLOR_OPTIONS[8],
  });

  // 挂载时加载一次：依赖为空，不引用组件内的函数，组件重渲染不会重复请求
  useEffect(() => {
    let cancelled = false;
    void fetchCategories()
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch(() => {
        if (!cancelled) showToast("分类加载失败，请刷新重试");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 增删改之后重新拉取（只在事件回调里调用） */
  async function reload(): Promise<void> {
    setCategories(await fetchCategories());
  }

  function startAddParent() {
    setEditing({ id: null, parentId: null });
    setForm({
      name: "",
      icon: kind === "income" ? "💰" : "📦",
      color: COLOR_OPTIONS[8],
    });
  }

  function startAddChild(parentId: string) {
    setEditing({ id: null, parentId });
    setForm({ name: "", icon: "📦", color: COLOR_OPTIONS[8] });
  }

  function startEdit(category: Category) {
    setEditing({ id: category.id, parentId: category.parentId });
    setForm({
      name: category.name,
      icon: category.icon,
      color: category.color,
    });
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      showToast("请输入分类名称");
      return;
    }
    if (editing?.id) {
      await updateCategory(editing.id, {
        name,
        icon: form.icon,
        color: form.color,
      });
      showToast("已保存修改");
    } else {
      await createCategory({
        name,
        kind,
        parentId: editing?.parentId ?? null,
        icon: form.icon,
        color: form.color,
        archived: false,
      });
      showToast(`已添加分类「${name}」`);
    }
    setEditing(null);
    await reload();
  }

  async function toggleArchive(category: Category) {
    const next = !category.archived;
    const message = next
      ? `归档后「${category.name}」不再出现在选择列表，历史数据保留。确认归档？`
      : `恢复分类「${category.name}」？`;
    if (!window.confirm(message)) return;
    // 归档一级分类时同步归档其子分类
    const ids = [
      category.id,
      ...categories.filter((c) => c.parentId === category.id).map((c) => c.id),
    ];
    for (const id of ids) {
      await updateCategory(id, { archived: next });
    }
    await reload();
  }

  const tops = categories.filter((c) => c.kind === kind && c.parentId === null);
  const editingCategory = editing?.id
    ? categories.find((c) => c.id === editing.id)
    : null;

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            aria-label="返回"
            className="flex size-10 items-center justify-center rounded-full"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="text-xl font-semibold">分类管理</h1>
        </div>
        <button
          type="button"
          onClick={startAddParent}
          aria-label="新增一级分类"
          className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </header>

      <div className="flex rounded-full bg-muted p-1">
        {(["expense", "income"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setKind(option);
              setEditing(null);
              setExpandedId(null);
            }}
            className={cn(
              "min-h-9 flex-1 rounded-full text-sm font-medium",
              kind === option
                ? "bg-background shadow-sm"
                : "text-muted-foreground",
            )}
          >
            {option === "expense" ? "支出分类" : "收入分类"}
          </button>
        ))}
      </div>

      {editing ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-border p-3">
          <h2 className="text-sm font-semibold">
            {editingCategory
              ? "编辑分类"
              : editing.parentId
                ? "新增二级分类"
                : "新增一级分类"}
          </h2>
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="分类名称"
            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {ICON_OPTIONS.map((icon) => (
              <button
                key={icon}
                type="button"
                onClick={() => setForm({ ...form, icon })}
                aria-label={`图标 ${icon}`}
                aria-pressed={form.icon === icon}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg border text-lg",
                  form.icon === icon
                    ? "border-primary bg-primary/10"
                    : "border-border",
                )}
              >
                {icon}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setForm({ ...form, color })}
                aria-label={`颜色 ${color}`}
                aria-pressed={form.color === color}
                className={cn(
                  "size-8 rounded-full border-2",
                  form.color === color
                    ? "border-foreground"
                    : "border-transparent",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
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
              onClick={() => setEditing(null)}
              className="min-h-11 rounded-xl bg-muted px-4 text-sm"
            >
              取消
            </button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col divide-y divide-border/60 rounded-2xl border border-border">
        {tops.map((category) => {
          const children = categories.filter((c) => c.parentId === category.id);
          const expanded = expandedId === category.id;
          return (
            <div key={category.id}>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : category.id)}
                  className="flex min-h-11 flex-1 items-center gap-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 items-center justify-center rounded-full text-lg"
                    style={{ backgroundColor: `${category.color}22` }}
                  >
                    {category.icon}
                  </span>
                  <span
                    className={cn(
                      "flex-1 font-medium",
                      category.archived && "opacity-50 line-through",
                    )}
                  >
                    {category.name}
                  </span>
                  {children.length > 0 ? (
                    <ChevronRight
                      className={cn(
                        "size-4 text-muted-foreground transition-transform",
                        expanded && "rotate-90",
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(category)}
                  className="min-h-9 px-2 text-xs text-muted-foreground"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => toggleArchive(category)}
                  className="min-h-9 px-2 text-xs text-muted-foreground"
                >
                  {category.archived ? "恢复" : "归档"}
                </button>
              </div>
              {expanded ? (
                <div className="flex flex-col gap-1 px-4 pb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {children.map((child) => (
                      <span
                        key={child.id}
                        className={cn(
                          "flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 text-xs",
                          child.archived && "opacity-50 line-through",
                        )}
                      >
                        {child.name}
                        <button
                          type="button"
                          onClick={() => startEdit(child)}
                          className="text-muted-foreground"
                          aria-label={`编辑 ${child.name}`}
                        >
                          ✎
                        </button>
                      </span>
                    ))}
                    {children.length === 0 ? (
                      <span className="py-1 text-xs text-muted-foreground">
                        暂无二级分类
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => startAddChild(category.id)}
                    className="flex min-h-8 w-fit items-center gap-1 text-xs text-primary"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />{" "}
                    添加二级分类
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      <p className="text-xs text-muted-foreground">
        有记录的分类不可删除，只能归档（CAT-03）；归档一级分类会同时归档其子分类。
      </p>
    </main>
  );
}
