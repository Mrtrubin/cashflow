// 领域类型：与 docs/需求文档.md §8.1 数据模型保持一致
// 金额单位一律为「分」（整数），日期为 YYYY-MM-DD 字符串

export type TxKind = "income" | "expense" | "transfer";
export type AccountType = "cash" | "bank" | "credit" | "ewallet" | "other";
export type CategoryKind = "income" | "expense";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: "CNY"; // v0.1 固定
  openingBalance: number; // 单位：分
  archived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null; // null 为一级分类
  icon: string;
  color: string;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Transaction {
  id: string;
  kind: TxKind;
  amount: number; // 单位：分，始终为正数
  occurredOn: string; // 'YYYY-MM-DD'
  occurredAt: string | null; // 'HH:mm'
  categoryId: string | null; // 转账为 null
  accountId: string; // 收入、支出的账户；转账的转出账户
  toAccountId: string | null; // 仅转账使用
  payee: string | null;
  note: string | null;
  tags: string[];
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Budget {
  id: string;
  categoryId: string | null; // null 表示总预算
  amount: number; // 单位：分，按月
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ImportBatch {
  id: string;
  source: "text" | "csv";
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** 账号设置（随账号同步）；主题等设备设置存 device settings */
export interface UserSettings {
  defaultAccountId: string | null;
  periodStartDay: number; // 1–28
  updatedAt: string;
}

/** 仅保存在本机的设备设置 */
export interface DeviceSettings {
  defaultAccountId: string | null; // 本机模式下兼作默认账户
  periodStartDay: number;
  theme: "light" | "dark" | "system";
  lastExportAt: string | null;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "现金",
  bank: "储蓄卡",
  credit: "信用卡",
  ewallet: "电子钱包",
  other: "其他",
};

export const TX_KIND_LABELS: Record<TxKind, string> = {
  income: "收入",
  expense: "支出",
  transfer: "转账",
};
