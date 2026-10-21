import { shiftDaysISO, todayISO } from "@/lib/date";
import { parseAmountToCents } from "@/lib/money";
import type { DateFormat, ParseRule } from "@/lib/parse-rule";
import type { Account, Category, Transaction, TxKind } from "@/lib/types";

// 文本解析由用户提供的 JS 脚本驱动（在 script-runner 的沙箱里执行）。
// 这里只负责：挑出数据行、把脚本返回值校验成预览行、匹配分类与账户、标记重复。
// 应用本身不假设任何列顺序、分隔符或日期写法。

export const MAX_IMPORT_LINES = 2000;

export type RowStatus = "ok" | "confirm" | "error";

export interface ParseContext {
  categories: Category[];
  accounts: Account[];
  defaultAccountId: string | null;
  /** 已有记录（未删除），用于疑似重复检测 */
  existingTxns: Transaction[];
}

export interface ParsedRow {
  lineNo: number; // 原始文本行号（含注释行）
  raw: string;
  status: RowStatus;
  reasons: string[];
  date: string | null; // 'YYYY-MM-DD'
  time: string | null; // 'HH:mm'
  kind: TxKind | null;
  /** 类型的来源：脚本 / 按分类推断 */
  kindSource: "script" | "category" | null;
  amountCents: number | null;
  /** 用户写的分类路径：[一级, 二级] */
  categoryPath: [string, string | null] | null;
  categoryId: string | null;
  /** 分类是否来自「商户记忆」（上次导入时用户指定过） */
  categoryFromHint: boolean;
  /** 用户写的账户：普通为 [账户, null]，转账为 [转出, 转入] */
  accountsPath: [string, string | null] | null;
  accountIds: [string | null, string | null];
  /** 账户来源：脚本 / 默认账户 */
  accountSource: "script" | "default" | null;
  note: string | null;
  tags: string[];
  duplicateOf: "db" | "text" | null;
}

export interface DataLine {
  lineNo: number;
  raw: string;
}

export interface CollectedLines {
  lines: DataLine[];
  commentCount: number;
  headerSkipped: boolean;
  truncated: boolean;
}

const KIND_ALIASES: Record<string, TxKind> = {
  支出: "expense",
  支: "expense",
  消费: "expense",
  收入: "income",
  收: "income",
  转账: "transfer",
  转: "transfer",
  expense: "expense",
  income: "income",
  transfer: "transfer",
};

/** 按规则挑出需要解析的数据行（跳过空行、注释、表头，并限制最大行数） */
export function collectLines(text: string, rule: ParseRule): CollectedLines {
  const result: CollectedLines = {
    lines: [],
    commentCount: 0,
    headerSkipped: false,
    truncated: false,
  };
  const rows = text.split(/\r?\n/);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (rule.commentPrefix && trimmed.startsWith(rule.commentPrefix)) {
      result.commentCount += 1;
      continue;
    }
    if (rule.skipHeader && !result.headerSkipped) {
      result.headerSkipped = true;
      continue;
    }
    if (result.lines.length >= MAX_IMPORT_LINES) {
      result.truncated = true;
      break;
    }
    result.lines.push({ lineNo: i + 1, raw });
  }

  return result;
}

export interface ScriptRowOutcome {
  value: Record<string, unknown> | null;
  error: string | null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function findCategoryById(
  ctx: ParseContext,
  id: string,
): { path: [string, string | null] } | null {
  const category = ctx.categories.find((item) => item.id === id);
  if (!category) return null;
  const parent = category.parentId
    ? ctx.categories.find((item) => item.id === category.parentId)
    : undefined;
  return {
    path: parent ? [parent.name, category.name] : [category.name, null],
  };
}

/**
 * 把脚本返回的一条结果转成预览行。
 * 返回 null 表示脚本主动跳过该行（返回 null/undefined）。
 */
export function buildScriptRow(
  raw: string,
  lineNo: number,
  outcome: ScriptRowOutcome,
  ctx: ParseContext,
  rule: ParseRule,
): ParsedRow | null {
  const row: ParsedRow = {
    lineNo,
    raw,
    status: "ok",
    reasons: [],
    date: null,
    time: null,
    kind: null,
    kindSource: null,
    amountCents: null,
    categoryPath: null,
    categoryId: null,
    categoryFromHint: false,
    accountsPath: null,
    accountIds: [null, null],
    accountSource: null,
    note: null,
    tags: [],
    duplicateOf: null,
  };

  const fail = (reason: string): ParsedRow => {
    row.status = "error";
    row.reasons.push(reason);
    return row;
  };

  if (outcome.error) return fail(`脚本报错：${outcome.error}`);
  if (outcome.value === null) return null;
  if (typeof outcome.value !== "object") {
    return fail("脚本返回的不是对象");
  }
  const value = outcome.value as Record<string, unknown>;

  // 日期
  const dateField = asText(value.date);
  const parsedDate = dateField
    ? parseDateField(dateField, rule.dateFormat)
    : null;
  if (!parsedDate) {
    return fail(
      dateField ? `日期「${dateField}」无法识别` : "脚本没有返回 date",
    );
  }
  row.date = parsedDate.date;
  row.time = parsedDate.time;

  // 时间
  const timeField = asText(value.time);
  if (timeField) {
    const clock = parseClock(timeField);
    if (!clock) return fail(`时间「${timeField}」无法识别`);
    row.time = clock;
  }

  // 金额（单位：元）
  const amountRaw = value.amount;
  const amountText =
    typeof amountRaw === "number" ? String(amountRaw) : asText(amountRaw);
  const amountCents = amountText ? parseAmountToCents(amountText) : null;
  if (amountCents === null) {
    return fail(
      amountText ? `金额「${amountText}」无法识别` : "脚本没有返回 amount",
    );
  }
  row.amountCents = amountCents;

  // 类型
  const kindField = asText(value.kind);
  if (kindField) {
    const kind = KIND_ALIASES[kindField];
    if (!kind) return fail(`类型「${kindField}」无法识别`);
    row.kind = kind;
    row.kindSource = "script";
  }

  // 分类：优先 categoryId，其次 category 名称
  const categoryIdField = asText(value.categoryId);
  const categoryField = asText(value.category);
  if (categoryIdField) {
    const found = findCategoryById(ctx, categoryIdField);
    if (!found) return fail("categoryId 对应的分类不存在");
    row.categoryPath = found.path;
  } else if (categoryField) {
    row.categoryPath = splitCategoryPath(categoryField, rule.categorySeparator);
  }

  // 账户：优先 id，其次名称；转账写「转出>转入」
  const accountIdField = asText(value.accountId);
  const toAccountIdField = asText(value.toAccountId);
  const accountField = asText(value.account);
  const toAccountField = asText(value.toAccount);

  if (accountIdField || toAccountIdField) {
    const from = accountIdField
      ? ctx.accounts.find((item) => item.id === accountIdField)
      : undefined;
    const to = toAccountIdField
      ? ctx.accounts.find((item) => item.id === toAccountIdField)
      : undefined;
    if (accountIdField && !from) return fail("accountId 对应的账户不存在");
    if (toAccountIdField && !to) return fail("toAccountId 对应的账户不存在");
    row.accountsPath = [from?.name ?? "", to?.name ?? null];
    if (from && to) row.kind = row.kind ?? "transfer";
  } else if (accountField) {
    if (accountField.includes(rule.transferSeparator)) {
      const [from, to] = accountField
        .split(rule.transferSeparator)
        .map((part) => part.trim());
      row.accountsPath = [from, to || null];
      row.kind = row.kind ?? "transfer";
    } else {
      row.accountsPath = [accountField, toAccountField || null];
      if (toAccountField) row.kind = row.kind ?? "transfer";
    }
  }

  // 备注与标签
  const noteField = asText(value.note);
  if (noteField) {
    row.tags = [...noteField.matchAll(/#([^\s#|]+)/g)].map((match) => match[1]);
    row.note = noteField.replace(/\s*#[^\s#|]+/g, "").trim() || null;
  }
  if (Array.isArray(value.tags)) {
    row.tags = value.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  if (row.status !== "error") resolveSemantics(row, ctx);
  return row;
}

function parseClock(field: string): string | null {
  const match = field.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseDateField(
  field: string,
  format: DateFormat,
): { date: string; time: string | null } | null {
  const value = field.trim();
  if (!value) return null;

  const relative: Record<string, number> = { 今天: 0, 昨天: -1, 前天: -2 };
  if (value in relative) {
    return { date: shiftDaysISO(todayISO(), relative[value]), time: null };
  }

  // 日期后可能跟时间：「2026-10-21 12:30」
  let datePart = value;
  let time: string | null = null;
  const withTime = value.match(/^(.+?)[ T](\d{1,2}):(\d{2})$/);
  if (withTime) {
    datePart = withTime[1].trim();
    time = parseClock(`${withTime[2]}:${withTime[3]}`);
    if (!time) return null;
  }

  const year = todayISO().slice(0, 4);
  const build = (
    y: string | number,
    m: string,
    d: string,
  ): { date: string; time: string | null } | null => {
    const month = Number(m);
    const day = Number(d);
    if (!isValidDate(Number(y), month, day)) return null;
    return { date: `${y}-${pad2(month)}-${pad2(day)}`, time };
  };

  switch (format) {
    case "ymd": {
      const match = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      return match ? build(match[1], match[2], match[3]) : null;
    }
    case "ymd-slash": {
      const match = datePart.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      return match ? build(match[1], match[2], match[3]) : null;
    }
    case "ymd-dot": {
      const match = datePart.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
      return match ? build(match[1], match[2], match[3]) : null;
    }
    case "md": {
      const match = datePart.match(/^(\d{1,2})[-/.](\d{1,2})$/);
      return match ? build(year, match[1], match[2]) : null;
    }
    case "cn": {
      const match = datePart.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
      return match ? build(match[1], match[2], match[3]) : null;
    }
    case "compact": {
      const match = datePart.match(/^(\d{4})(\d{2})(\d{2})$/);
      return match ? build(match[1], match[2], match[3]) : null;
    }
    default: {
      for (const candidate of [
        "ymd",
        "ymd-slash",
        "ymd-dot",
        "cn",
        "compact",
        "md",
      ] as DateFormat[]) {
        const result = parseDateField(datePart, candidate);
        if (result) return result;
      }
      return null;
    }
  }
}

function splitCategoryPath(
  field: string,
  separator: string,
): [string, string | null] {
  const parts = field
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [field.trim(), null];
}

/** 推断类型、匹配分类与账户，产出「需确认」原因 */
function resolveSemantics(row: ParsedRow, ctx: ParseContext): void {
  const isTransfer = row.kind === "transfer";

  // 分类匹配（转账不需要分类）
  let matched: Category | null = null;
  if (!isTransfer && row.categoryPath) {
    const [parentName, childName] = row.categoryPath;
    const wantedKind =
      row.kind === "income" ? "income" : row.kind ? "expense" : null;
    const parent = childName
      ? findCategoryLoose(ctx.categories, parentName)
      : findCategory(ctx.categories, parentName, null, wantedKind);
    if (!parent) {
      row.status = "confirm";
      row.reasons.push(`分类「${row.categoryPath.join("/")}」不存在`);
    } else if (childName) {
      const child = findCategory(
        ctx.categories,
        childName,
        parent.id,
        parent.kind,
      );
      if (!child) {
        row.status = "confirm";
        row.reasons.push(`二级分类「${childName}」不存在`);
      } else {
        matched = child;
      }
    } else {
      matched = parent;
    }

    if (!row.kind && matched) {
      row.kind = matched.kind === "income" ? "income" : "expense";
      row.kindSource = "category";
    } else if (matched && row.kind && matched.kind !== row.kind) {
      row.status = "confirm";
      row.reasons.push(
        `分类「${matched.name}」与类型「${row.kind === "income" ? "收入" : "支出"}」不一致`,
      );
      matched = null;
    }
  }

  if (!row.kind) {
    row.status = "confirm";
    row.reasons.push(
      row.categoryPath ? "类型无法推断" : "脚本没有给出类型，且无法从分类推断",
    );
  }

  // 账户匹配
  const [fromName, toName] = row.accountsPath ?? ["", null];
  if (isTransfer) {
    const from = fromName ? findAccount(ctx.accounts, fromName) : null;
    const to = toName ? findAccount(ctx.accounts, toName) : null;
    if (!from) {
      row.status = "confirm";
      row.reasons.push(`转出账户「${fromName || "（空）"}」不存在`);
    }
    if (!to) {
      row.status = "confirm";
      row.reasons.push(`转入账户「${toName || "（空）"}」不存在`);
    }
    row.accountIds = [from?.id ?? null, to?.id ?? null];
    row.accountSource = from ? "script" : null;
    if (from && to && from.id === to.id) {
      row.status = "error";
      row.reasons.push("转出与转入账户不能相同");
    }
  } else {
    const from = fromName ? findAccount(ctx.accounts, fromName) : null;
    if (fromName && !from) {
      row.status = "confirm";
      row.reasons.push(`账户「${fromName}」不存在`);
    }
    if (from) {
      row.accountIds = [from.id, null];
      row.accountSource = "script";
    } else if (ctx.defaultAccountId) {
      // 脚本没有给出账户（或写了不存在的账户）时落到默认账户
      row.accountIds = [ctx.defaultAccountId, null];
      row.accountSource = "default";
    } else {
      row.status = "confirm";
      row.reasons.push("脚本没有给出账户，且没有默认账户");
    }
  }

  // 转账不应带分类；收入/支出必须有分类
  if (isTransfer) {
    row.categoryId = null;
  } else if (matched) {
    row.categoryId = matched.id;
  } else if (!row.categoryPath) {
    row.status = "confirm";
    row.reasons.push("脚本没有给出分类，需要手动选择");
  }
}

/** 不限类型查找一级分类（类型留空时用于推断） */
function findCategoryLoose(
  categories: Category[],
  name: string,
): Category | null {
  const target = name.trim();
  return (
    categories.find(
      (category) =>
        !category.deletedAt &&
        !category.archived &&
        category.parentId === null &&
        category.name === target,
    ) ?? null
  );
}

function findCategory(
  categories: Category[],
  name: string,
  parentId: string | null,
  kind: Category["kind"] | null,
): Category | null {
  const target = name.trim();
  return (
    categories.find(
      (category) =>
        !category.deletedAt &&
        !category.archived &&
        category.name === target &&
        (category.parentId ?? null) === (parentId ?? null) &&
        (kind ? category.kind === kind : true),
    ) ?? null
  );
}

function findAccount(accounts: Account[], name: string): Account | null {
  const target = name.trim();
  return (
    accounts.find(
      (account) =>
        !account.deletedAt && !account.archived && account.name === target,
    ) ?? null
  );
}

export function markDuplicatesInText(rows: ParsedRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status === "error") continue;
    const key = duplicateKey(
      row.date,
      row.kind,
      row.amountCents,
      row.accountIds[0],
      row.accountIds[1],
    );
    if (!key) continue;
    if (seen.has(key)) {
      row.duplicateOf = "text";
      if (row.status === "ok") row.status = "confirm";
      row.reasons.push("与本次文本中前面的行疑似重复");
    } else {
      seen.add(key);
    }
  }
}

/** 与已有记录比对（日期、类型、金额、账户完全一致 → 疑似重复） */
export function markDuplicatesAgainstDb(
  rows: ParsedRow[],
  existingTxns: Transaction[],
): void {
  const keys = new Set(
    existingTxns
      .filter((txn) => !txn.deletedAt)
      .map((txn) =>
        duplicateKey(
          txn.occurredOn,
          txn.kind,
          txn.amount,
          txn.accountId,
          txn.toAccountId,
        ),
      ),
  );
  for (const row of rows) {
    if (row.status === "error" || row.duplicateOf) continue;
    const key = duplicateKey(
      row.date,
      row.kind,
      row.amountCents,
      row.accountIds[0],
      row.accountIds[1],
    );
    if (!key || !keys.has(key)) continue;
    row.duplicateOf = "db";
    if (row.status === "ok") row.status = "confirm";
    row.reasons.push("与已有记录疑似重复");
  }
}

function duplicateKey(
  date: string | null,
  kind: TxKind | null,
  amountCents: number | null,
  accountId: string | null,
  toAccountId: string | null,
): string | null {
  if (!date || !kind || amountCents === null || !accountId) return null;
  return [date, kind, amountCents, accountId, toAccountId ?? ""].join("|");
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const last = new Date(year, month, 0).getDate();
  return day <= last;
}
