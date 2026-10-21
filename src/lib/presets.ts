import { nowIso } from "@/lib/date";
import type { Account, AccountType, Category, CategoryKind } from "@/lib/types";

// 附录 A：预设分类（可修改）
interface CategoryPreset {
  name: string;
  icon: string;
  color: string;
  children?: string[];
}

export const EXPENSE_PRESETS: CategoryPreset[] = [
  {
    name: "餐饮",
    icon: "🍜",
    color: "#f97316",
    children: ["早餐", "午餐", "晚餐", "外卖", "零食饮料"],
  },
  {
    name: "交通",
    icon: "🚇",
    color: "#3b82f6",
    children: ["地铁", "公交", "打车", "加油", "停车"],
  },
  {
    name: "购物",
    icon: "🛍️",
    color: "#ec4899",
    children: ["日用品", "服饰", "数码", "网购"],
  },
  {
    name: "居住",
    icon: "🏠",
    color: "#8b5cf6",
    children: ["房租", "水电燃气", "物业", "通讯"],
  },
  {
    name: "娱乐",
    icon: "🎮",
    color: "#06b6d4",
    children: ["电影", "游戏", "旅行", "会员订阅"],
  },
  {
    name: "医疗",
    icon: "💊",
    color: "#ef4444",
    children: ["门诊", "药品", "体检"],
  },
  { name: "教育", icon: "📚", color: "#14b8a6", children: ["书籍", "课程"] },
  {
    name: "人情",
    icon: "🎁",
    color: "#eab308",
    children: ["红包", "礼物", "请客"],
  },
  { name: "其他", icon: "📦", color: "#94a3b8" },
];

export const INCOME_PRESETS: CategoryPreset[] = [
  { name: "工资", icon: "💼", color: "#22c55e", children: ["月薪", "奖金"] },
  { name: "理财", icon: "💰", color: "#0ea5e9", children: ["利息", "分红"] },
  { name: "兼职", icon: "🧑‍💻", color: "#a855f7" },
  { name: "其他", icon: "📥", color: "#94a3b8" },
];

interface AccountPreset {
  name: string;
  type: AccountType;
}

const ACCOUNT_PRESETS: AccountPreset[] = [
  { name: "微信", type: "ewallet" },
  { name: "支付宝", type: "ewallet" },
  { name: "现金", type: "cash" },
  { name: "银行卡", type: "bank" },
];

export const DEFAULT_ACCOUNT_NAME = "微信";

function uid(): string {
  return crypto.randomUUID();
}

export function presetAccounts(): Account[] {
  return ACCOUNT_PRESETS.map((preset, index) => ({
    id: uid(),
    name: preset.name,
    type: preset.type,
    currency: "CNY" as const,
    openingBalance: 0,
    archived: false,
    sortOrder: index,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
  }));
}

export function presetCategories(): Category[] {
  const build = (
    kind: CategoryKind,
    presets: CategoryPreset[],
    sortBase: number,
  ) =>
    presets.flatMap((preset, parentIndex) => {
      const parentId = uid();
      const ts = nowIso();
      const parent: Category = {
        id: parentId,
        name: preset.name,
        kind,
        parentId: null,
        icon: preset.icon,
        color: preset.color,
        archived: false,
        sortOrder: sortBase + parentIndex,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      const children: Category[] = (preset.children ?? []).map(
        (name, childIndex) => ({
          id: uid(),
          name,
          kind,
          parentId,
          icon: preset.icon,
          color: preset.color,
          archived: false,
          sortOrder: childIndex,
          createdAt: ts,
          updatedAt: ts,
          deletedAt: null,
        }),
      );
      return [parent, ...children];
    });

  return [
    ...build("expense", EXPENSE_PRESETS, 0),
    ...build("income", INCOME_PRESETS, 0),
  ];
}
