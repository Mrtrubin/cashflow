"use client";

import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { Category, CategoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CategoryPickerProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  kind: CategoryKind;
  /** 最近使用的分类 ID（新的在前） */
  recentIds: string[];
  value: string | null;
  onSelect: (categoryId: string) => void;
}

interface TopCategory {
  category: Category;
  children: Category[];
}

/** 分类选择：最近使用优先展示，两级结构（REC-04） */
export function CategoryPicker({
  open,
  onClose,
  categories,
  kind,
  recentIds,
  value,
  onSelect,
}: CategoryPickerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { topCategories, recent } = useMemo(() => {
    const active = categories.filter(
      (c) => c.kind === kind && !c.deletedAt && !c.archived,
    );
    const tops: TopCategory[] = active
      .filter((c) => c.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => ({
        category,
        children: active
          .filter((c) => c.parentId === category.id)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }));
    const recentList = recentIds
      .map((id) => active.find((c) => c.id === id))
      .filter((c): c is Category => Boolean(c))
      .slice(0, 8);
    return { topCategories: tops, recent: recentList };
  }, [categories, kind, recentIds]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative mx-auto max-h-[75dvh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 flex items-center justify-between border-b bg-background px-4 py-3">
          <span className="font-semibold">选择分类</span>
          <button
            type="button"
            className="text-sm text-muted-foreground"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="px-4 py-3">
          {recent.length > 0 ? (
            <>
              <p className="pb-2 text-xs text-muted-foreground">最近使用</p>
              <div className="flex flex-wrap gap-2 pb-3">
                {recent.map((category) => (
                  <ChipButton
                    key={`recent-${category.id}`}
                    category={category}
                    selected={value === category.id}
                    onClick={() => {
                      onSelect(category.id);
                      onClose();
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}

          <div className="flex flex-col divide-y divide-border">
            {topCategories.map(({ category, children }) => {
              const expanded = expandedId === category.id;
              const hasChildren = children.length > 0;
              return (
                <div key={category.id} className="py-1">
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (hasChildren) {
                          setExpandedId(expanded ? null : category.id);
                        } else {
                          onSelect(category.id);
                          onClose();
                        }
                      }}
                      className="flex min-h-11 flex-1 items-center gap-3 px-1 text-left"
                    >
                      <span aria-hidden="true">{category.icon}</span>
                      <span
                        className={cn(
                          "font-medium",
                          value === category.id && "text-primary",
                        )}
                      >
                        {category.name}
                      </span>
                    </button>
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-label={`展开 ${category.name}`}
                        onClick={() =>
                          setExpandedId(expanded ? null : category.id)
                        }
                        className="flex h-11 w-11 items-center justify-center text-muted-foreground"
                      >
                        <ChevronDown
                          className={cn(
                            "size-4 transition-transform",
                            expanded && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </div>
                  {expanded && hasChildren ? (
                    <div className="flex flex-wrap gap-2 px-1 py-2">
                      {children.map((child) => (
                        <ChipButton
                          key={child.id}
                          category={child}
                          selected={value === child.id}
                          onClick={() => {
                            onSelect(child.id);
                            onClose();
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipButton({
  category,
  selected,
  onClick,
}: {
  category: Category;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-muted/50 text-foreground",
      )}
    >
      <span aria-hidden="true">{category.icon}</span>
      {category.name}
    </button>
  );
}

/** 由分类 ID 快速取展示信息（含父级名） */
export function categoryLabel(
  categoryId: string | null,
  categories: Category[],
): { icon: string; name: string; color: string } | null {
  if (!categoryId) return null;
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return null;
  if (category.parentId) {
    const parent = categories.find((c) => c.id === category.parentId);
    return {
      icon: category.icon,
      name: `${parent?.name ?? ""}/${category.name}`,
      color: category.color,
    };
  }
  return { icon: category.icon, name: category.name, color: category.color };
}
