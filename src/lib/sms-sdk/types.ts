// 短信 SDK 的公共类型。
// 这一层不依赖应用内的业务类型，方便单独复用或以后拆成独立包。

export type SmsMessageType =
  | "inbox"
  | "sent"
  | "draft"
  | "outbox"
  | "failed"
  | "queued"
  | "unknown";

export interface SmsMessage {
  /** 备份内的短信 id；没有时由地址 + 时间生成 */
  id: string;
  /** 发送方号码或服务号 */
  address: string;
  /** 短信正文 */
  body: string;
  subject: string | null;
  type: SmsMessageType;
  /** 收到时间（epoch ms） */
  receivedAt: number;
  /** 发送时间（epoch ms），备份没有时与 receivedAt 相同 */
  sentAt: number | null;
  read: boolean;
  seen: boolean;
  serviceCenter: string | null;
  /** 备份里附带的第三方消息 id（如小米推送） */
  externalId: string | null;
}

export interface SmsBackupMeta {
  format: "miui-backup";
  packageName: string | null;
  displayName: string | null;
  /** MIUI 备份头里的版本号 */
  miuiVersion: number | null;
  /** Android Backup 版本号 */
  androidBackupVersion: number | null;
  compressed: boolean;
  messageCount: number;
}

export interface SmsBackup {
  meta: SmsBackupMeta;
  messages: SmsMessage[];
  /** 能看懂但没有导入的内容，例如跳过的非短信文件 */
  warnings: string[];
}

export type SmsBillKind = "expense" | "income";

export interface SmsBillTransaction {
  /** 对应 SmsMessage.id */
  messageId: string;
  /** 短信收到时间（epoch ms） */
  receivedAt: number;
  /** 交易日期，本地时区 YYYY-MM-DD */
  date: string;
  /** 交易时间，本地时区 HH:mm；没有时用短信收到时间 */
  time: string | null;
  kind: SmsBillKind;
  amountCents: number;
  balanceCents: number | null;
  /** 银行/机构简称，例如「工商银行」「中国银行」「杭州银行」 */
  bank: string | null;
  /** 卡号后四位 */
  cardTail: string | null;
  cardType: "credit" | "debit" | null;
  /** 短信里的动作：消费 / 充值 / 还款 / 转账 / 退款 / 收入 … */
  flow: string | null;
  /** 支付渠道：支付宝 / 财付通 / 网银在线 / 微信支付 … */
  channel: string | null;
  /** 商户或摘要 */
  merchant: string | null;
  /** 适合给账本用的备注（已按「动作+渠道-商户」整理） */
  note: string;
  /** 建议的一级分类名，例如「餐饮」「工资」 */
  categoryHint: string | null;
  /** 建议的账户，例如「工商银行2454」「微信」 */
  accountHint: string | null;
  tags: string[];
  /** 原始短信正文 */
  raw: string;
  address: string;
  /** 识别置信度 0–1 */
  confidence: number;
  /** 命中的规则 id，方便排查 */
  ruleId: string;
}

export interface SmsBillRuleContext {
  message: SmsMessage;
  body: string;
  receivedAt: number;
}

export interface SmsBillRuleMatch {
  kind: SmsBillKind;
  amountCents: number;
  balanceCents?: number | null;
  date: string;
  time?: string | null;
  bank?: string | null;
  cardTail?: string | null;
  cardType?: "credit" | "debit" | null;
  flow?: string | null;
  channel?: string | null;
  merchant?: string | null;
  note?: string | null;
  categoryHint?: string | null;
  accountHint?: string | null;
  tags?: string[];
  confidence?: number;
}

export interface SmsBillRule {
  id: string;
  description?: string;
  /** 钱包/支付平台短信；includeWallets=false 时跳过 */
  wallet?: boolean;
  match: (context: SmsBillRuleContext) => SmsBillRuleMatch | null | undefined;
}

export interface ExtractBillOptions {
  /** 默认只解析收件箱短信 */
  includeSent?: boolean;
  /** 是否包含微信/支付宝等钱包短信，默认 true */
  includeWallets?: boolean;
  /** 起始时间（含），支持 Date / epoch ms / ISO 字符串 */
  since?: Date | number | string;
  /** 结束时间（含） */
  until?: Date | number | string;
  /** 是否按「地址 + 收到时间 + 正文」去掉完全重复的短信，默认 true */
  dedupeMessages?: boolean;
  /** 自定义规则集合，默认使用内置规则；传入时会替换内置规则 */
  rules?: readonly SmsBillRule[];
}

export interface ExtractBillResult {
  transactions: SmsBillTransaction[];
  /** 参与识别的短信数（过滤时间/收发类型之后） */
  total: number;
  /** 识别出的账单数 */
  matched: number;
  /** 未识别的短信数 */
  skipped: number;
  byBank: Record<string, number>;
}
