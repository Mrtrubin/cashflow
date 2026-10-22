import { z } from "zod";

// 服务端入参校验：客户端提交的任何行都必须先过这里。
// 金额单位统一为「分」（整数），时间由服务端写入。

const uuid = z.uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:mm");
const positiveCents = z.number().int().positive();
const nullableText = z.string().trim().max(200).nullable();

export const accountRowSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(40),
    type: z.enum(["cash", "bank", "credit", "ewallet", "other"]),
    currency: z.literal("CNY").default("CNY"),
    openingBalance: z.number().int(),
    archived: z.boolean(),
    sortOrder: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
  })
  .strict();

export const categoryRowSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(40),
    kind: z.enum(["income", "expense"]),
    parentId: uuid.nullable(),
    icon: z.string().max(40).default(""),
    color: z.string().max(40).default(""),
    archived: z.boolean(),
    sortOrder: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
  })
  .strict();

export const importBatchRowSchema = z
  .object({
    id: uuid,
    source: z.enum(["text", "csv", "sms"]),
    total: z.number().int().nonnegative(),
    imported: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
  })
  .strict();

export const transactionRowSchema = z
  .object({
    id: uuid,
    kind: z.enum(["income", "expense", "transfer"]),
    amount: positiveCents,
    occurredOn: isoDate,
    occurredAt: clockTime.nullable(),
    categoryId: uuid.nullable(),
    accountId: uuid,
    toAccountId: uuid.nullable(),
    payee: nullableText,
    note: nullableText,
    tags: z.array(z.string().trim().min(1).max(24)).max(20),
    importBatchId: uuid.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
  })
  .strict()
  .refine((row) => (row.kind === "transfer") === (row.toAccountId !== null), {
    message: "转账必须且只能指定转入账户",
  })
  .refine(
    (row) => row.kind !== "transfer" || row.toAccountId !== row.accountId,
    {
      message: "转出与转入账户不能相同",
    },
  );

export const budgetRowSchema = z
  .object({
    id: uuid,
    categoryId: uuid.nullable(),
    amount: positiveCents,
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
  })
  .strict();

export const userSettingsRowSchema = z
  .object({
    defaultAccountId: uuid.nullable(),
    periodStartDay: z.number().int().min(1).max(28),
    updatedAt: z.string(),
  })
  .strict();

// 外层只校验「是数组、不超量」；逐行校验在 parsePushBody 里做，
// 这样一行不合法不会让整批变更被 400 打回（客户端会无限重试）。
export const pushEnvelopeSchema = z
  .object({
    accounts: z.array(z.unknown()).max(200).optional(),
    categories: z.array(z.unknown()).max(200).optional(),
    importBatches: z.array(z.unknown()).max(200).optional(),
    transactions: z.array(z.unknown()).max(200).optional(),
    budgets: z.array(z.unknown()).max(200).optional(),
    settings: z.unknown().optional(),
  })
  .strict();

export type AccountRow = z.infer<typeof accountRowSchema>;
export type CategoryRow = z.infer<typeof categoryRowSchema>;
export type ImportBatchRow = z.infer<typeof importBatchRowSchema>;
export type TransactionRow = z.infer<typeof transactionRowSchema>;
export type BudgetRow = z.infer<typeof budgetRowSchema>;
export type UserSettingsRow = z.infer<typeof userSettingsRowSchema>;
export interface PushPayload {
  accounts?: AccountRow[];
  categories?: CategoryRow[];
  importBatches?: ImportBatchRow[];
  transactions?: TransactionRow[];
  budgets?: BudgetRow[];
  settings?: UserSettingsRow | null;
}

export interface RejectedInput {
  entity: string;
  id: string;
  reason: string;
}

function extractId(row: unknown): string {
  if (row && typeof row === "object" && "id" in row) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "-";
}

function splitRows<T>(
  entity: string,
  schema: z.ZodType<T>,
  rows: unknown[] | undefined,
  rejected: RejectedInput[],
): T[] {
  if (!rows) return [];
  const valid: T[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      rejected.push({
        entity,
        id: extractId(row),
        reason: parsed.error.issues[0]?.message ?? "字段格式不正确",
      });
    }
  }
  return valid;
}

/** 逐行校验推送内容：合法行照常入库，非法行单独返回 */
export function parsePushBody(input: unknown): {
  payload: PushPayload;
  rejected: RejectedInput[];
} {
  const envelope = pushEnvelopeSchema.parse(input);
  const rejected: RejectedInput[] = [];
  const payload: PushPayload = {
    accounts: splitRows(
      "accounts",
      accountRowSchema,
      envelope.accounts,
      rejected,
    ),
    categories: splitRows(
      "categories",
      categoryRowSchema,
      envelope.categories,
      rejected,
    ),
    importBatches: splitRows(
      "importBatches",
      importBatchRowSchema,
      envelope.importBatches,
      rejected,
    ),
    transactions: splitRows(
      "transactions",
      transactionRowSchema,
      envelope.transactions,
      rejected,
    ),
    budgets: splitRows("budgets", budgetRowSchema, envelope.budgets, rejected),
  };

  if (envelope.settings !== undefined) {
    const parsed = userSettingsRowSchema
      .nullable()
      .safeParse(envelope.settings);
    if (parsed.success) payload.settings = parsed.data;
    else
      rejected.push({
        entity: "settings",
        id: "settings",
        reason: parsed.error.issues[0]?.message ?? "字段格式不正确",
      });
  }

  return { payload, rejected };
}

export const restoreSchema = z
  .object({
    schemaVersion: z.number().int(),
    accounts: z.array(accountRowSchema).max(5000),
    categories: z.array(categoryRowSchema).max(5000),
    importBatches: z.array(importBatchRowSchema).max(2000),
    transactions: z.array(transactionRowSchema).max(20000),
    budgets: z.array(budgetRowSchema).max(1000),
    settings: userSettingsRowSchema.nullable(),
  })
  .strict();

export type RestorePayload = z.infer<typeof restoreSchema>;
