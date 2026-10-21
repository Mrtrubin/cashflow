// 文本导入的「解析规则」：应用不内置任何默认格式。
// 规则就是一段 JS 脚本（沙箱执行），由用户自己写、或让 AI 生成后粘贴进来。

import { nowIso } from "@/lib/date";

export type DateFormat =
  | "auto"
  | "ymd"
  | "ymd-slash"
  | "ymd-dot"
  | "md"
  | "cn"
  | "compact";

export interface ParseRule {
  id: string;
  name: string;
  /** 函数体：new Function("line", "ctx", "index", script) */
  script: string;
  /** 首行是表头，解析时跳过 */
  skipHeader: boolean;
  /** 注释行前缀，空字符串表示不识别注释 */
  commentPrefix: string;
  /** 脚本返回的日期按哪种写法解析（默认自动识别） */
  dateFormat: DateFormat;
  /** 分类层级分隔符，如「餐饮/午饭」中的 / */
  categorySeparator: string;
  /** 转账账户分隔符，如「银行卡>现金」中的 > */
  transferSeparator: string;
  createdAt: string;
  updatedAt: string;
}

export const DATE_FORMAT_OPTIONS: Array<{
  value: DateFormat;
  label: string;
  sample: string;
}> = [
  { value: "auto", label: "自动识别", sample: "2026-10-21 / 10-21" },
  { value: "ymd", label: "YYYY-MM-DD", sample: "2026-10-21" },
  { value: "ymd-slash", label: "YYYY/M/D", sample: "2026/10/21" },
  { value: "ymd-dot", label: "YYYY.M.D", sample: "2026.10.21" },
  { value: "md", label: "M-D（当年）", sample: "10-21" },
  { value: "cn", label: "YYYY年M月D日", sample: "2026年10月21日" },
  { value: "compact", label: "YYYYMMDD", sample: "20261021" },
];

/** 新建规则的初始值：只有空脚本，需要用户或 AI 填充 */
export function createEmptyRule(name: string, script = ""): ParseRule {
  const ts = nowIso();
  return {
    id: crypto.randomUUID(),
    name,
    script,
    skipHeader: false,
    commentPrefix: "",
    dateFormat: "auto",
    categorySeparator: "/",
    transferSeparator: ">",
    createdAt: ts,
    updatedAt: ts,
  };
}

/** 兜底清洗：规则来自本机存储，仍按结构校验一遍，坏数据直接丢弃 */
export function normalizeRule(input: unknown): ParseRule | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  // 旧版「按列解析」规则没有脚本，直接丢弃
  if (typeof raw.script !== "string" || !raw.script.trim()) return null;

  const dateFormat = DATE_FORMAT_OPTIONS.some(
    (option) => option.value === raw.dateFormat,
  )
    ? (raw.dateFormat as DateFormat)
    : "auto";
  const ts = nowIso();
  return {
    id: raw.id,
    name: raw.name,
    script: raw.script,
    skipHeader: Boolean(raw.skipHeader),
    commentPrefix:
      typeof raw.commentPrefix === "string" ? raw.commentPrefix : "",
    dateFormat,
    categorySeparator:
      typeof raw.categorySeparator === "string" && raw.categorySeparator
        ? raw.categorySeparator
        : "/",
    transferSeparator:
      typeof raw.transferSeparator === "string" && raw.transferSeparator
        ? raw.transferSeparator
        : ">",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : ts,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : ts,
  };
}

export function validateRule(rule: ParseRule): string[] {
  const issues: string[] = [];
  if (!rule.name.trim()) issues.push("请填写规则名称");
  if (!rule.script.trim()) issues.push("请粘贴或编写脚本");
  return issues;
}

/** 从 AI 回复里取出代码：去掉 ```js 围栏与前后说明文字 */
export function extractScript(input: string): string {
  const fenced = input.match(
    /```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/i,
  );
  const code = (fenced ? fenced[1] : input).trim();
  return code.replace(/^\s*(?:const|let|var)?\s*parseLine\s*=\s*/m, "").trim();
}

/** 脚本规则示例：用户点「插入示例」时填入 */
export const SCRIPT_TEMPLATE = `// 每行调用一次，返回一条记录；返回 null 跳过该行
// 可用参数：line（当前行文本）、ctx（{ accounts, categories, defaultAccountId, today }）、index
// 可导入的硬性条件：非转账必须有分类，转账必须有「转出>转入」两端
const cells = line.split(",");
if (cells.length < 3) return null;

return {
  date: cells[0],              // 必填，YYYY-MM-DD
  amount: cells[2],            // 必填，单位：元
  kind: "expense",             // 可选：income / expense / transfer
  category: cells[3] || "其他", // 必须是账本里已有的分类，拿不准写「其他」
  account: cells[4],           // 可选：账本里已有的账户；转账写「转出>转入」
  note: cells[5],              // 可选：备注，#标签 会被提取
};
`;

/** 脚本返回值说明，用于编辑器里的帮助文案 */
export const SCRIPT_FIELDS: Array<{ field: string; desc: string }> = [
  { field: "date", desc: "必填，YYYY-MM-DD；可用 ctx.today 补年份" },
  { field: "amount", desc: "必填，单位元，支持「1,234.50」「¥35」" },
  { field: "kind", desc: "income / expense / transfer，缺省时按分类推断" },
  {
    field: "category",
    desc: "必须是账本里已有的分类名（可写「一级/二级」）或用 categoryId；拿不准写「其他」，否则该行只能手动选",
  },
  {
    field: "account",
    desc: "必须是账本里已有的账户名；转账写「转出>转入」，两端都要有，否则该行无法导入",
  },
  { field: "note", desc: "备注，可用 tags 数组直接给标签" },
  { field: "time", desc: "HH:mm，可省略" },
];
