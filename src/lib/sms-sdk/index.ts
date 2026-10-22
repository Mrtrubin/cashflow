// 短信解析 SDK 的公共入口。
//
// 典型用法：
//   const backup = await parseSmsBackup(file);
//   const result = extractBillTransactions(backup.messages);
//   result.transactions.forEach(...)

export {
  extractBillTransactions,
  extractDate,
  normalizeSmsText,
  parseBillSms,
  SMS_BILL_RULES,
  suggestCategory,
} from "./bill-rules";
export type { SmsBackupInput } from "./miui-backup";
export { parseAndroidBackupTar, parseSmsBackup } from "./miui-backup";
export type {
  ExtractBillOptions,
  ExtractBillResult,
  SmsBackup,
  SmsBackupMeta,
  SmsBillKind,
  SmsBillRule,
  SmsBillRuleContext,
  SmsBillRuleMatch,
  SmsBillTransaction,
  SmsMessage,
  SmsMessageType,
} from "./types";
