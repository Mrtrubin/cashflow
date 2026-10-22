// 小米手机「短信」本地备份解析。
//
// 文件结构（实测 MIUI OS3）：
//   ZIP
//     ├─ descript.xml
//     └─ 短信(com.android.mms).bak
//          ├─ MIUI BACKUP 头
//          ├─ ANDROID BACKUP 头（未加密时 encryption = none）
//          └─ tar
//               └─ apps/com.android.mms/miui_bak/_tmp_bak（protobuf）
//
// 解析只在调用方环境执行，不发任何网络请求。

import {
  decodeUtf8,
  fieldBytes,
  fieldInt,
  fieldText,
  gunzip,
  indexOfBytes,
  readProtobufFields,
} from "./binary";
import { parseTar } from "./tar";
import type {
  SmsBackup,
  SmsBackupMeta,
  SmsMessage,
  SmsMessageType,
} from "./types";
import { isZip, readZip } from "./zip";

const ANDROID_BACKUP = new TextEncoder().encode("ANDROID BACKUP\n");
const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b]);
const SQLITE_MAGIC = new TextEncoder().encode("SQLite format 3");

export type SmsBackupInput = Blob | ArrayBuffer | ArrayBufferView;

function toBytes(input: SmsBackupInput): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    throw new Error("Blob 输入需要先调用 parseSmsBackup（异步）");
  }
  throw new Error("不支持的短信备份输入类型");
}

async function toBytesAsync(input: SmsBackupInput): Promise<Uint8Array> {
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  return toBytes(input);
}

function readLine(
  data: Uint8Array,
  start: number,
): { line: string; next: number } | null {
  const newline = data.indexOf(0x0a, start);
  if (newline < 0) return null;
  return {
    line: decodeUtf8(data.subarray(start, newline)).trim(),
    next: newline + 1,
  };
}

interface AndroidBackupHeader {
  version: number;
  compressed: boolean;
  encryption: string;
  payloadStart: number;
  miuiVersion: number | null;
  packageName: string | null;
  displayName: string | null;
}

function parseAndroidBackupHeader(data: Uint8Array): AndroidBackupHeader {
  const marker = indexOfBytes(data, ANDROID_BACKUP);
  if (marker < 0) {
    throw new Error("不是 Android/MIUI 短信备份文件");
  }

  const cursor = marker + ANDROID_BACKUP.length;
  const versionLine = readLine(data, cursor);
  const compressedLine = versionLine ? readLine(data, versionLine.next) : null;
  const encryptionLine = compressedLine
    ? readLine(data, compressedLine.next)
    : null;
  if (!versionLine || !compressedLine || !encryptionLine) {
    throw new Error("Android Backup 头不完整");
  }

  const version = Number(versionLine.line);
  const compressed = compressedLine.line === "1";
  const encryption = encryptionLine.line || "none";
  if (!Number.isFinite(version)) {
    throw new Error("Android Backup 版本号无法识别");
  }
  if (encryption !== "none") {
    throw new Error("暂不支持加密的短信备份，请在手机备份时关闭加密");
  }

  // MIUI 头在 ANDROID BACKUP 之前，格式大致为：
  // MIUI BACKUP\n2\ncom.android.mms 短信\n1\n0\n
  let miuiVersion: number | null = null;
  let packageName: string | null = null;
  let displayName: string | null = null;
  const prefixText = decodeUtf8(data.subarray(0, marker));
  const lines = prefixText.split("\n").map((line) => line.trim());
  if (lines[0] === "MIUI BACKUP") {
    miuiVersion = Number(lines[1]) || null;
    const packageLine = lines[2] ?? "";
    const space = packageLine.indexOf(" ");
    if (space > 0) {
      packageName = packageLine.slice(0, space);
      displayName = packageLine.slice(space + 1) || null;
    } else if (packageLine) {
      packageName = packageLine;
    }
  }

  return {
    version,
    compressed,
    encryption,
    payloadStart: encryptionLine.next,
    miuiVersion,
    packageName,
    displayName,
  };
}

function looksLikeSmsRecord(
  fields: ReturnType<typeof readProtobufFields>,
): boolean {
  return (
    fieldBytes(fields, 6) !== null &&
    fieldBytes(fields, 4) !== null &&
    fieldInt(fields, 7) !== null
  );
}

function collectRecordFields(
  fields: ReturnType<typeof readProtobufFields>,
  output: Array<ReturnType<typeof readProtobufFields>>,
  depth: number,
): void {
  if (looksLikeSmsRecord(fields)) {
    output.push(fields);
    return;
  }
  if (depth >= 5) return;

  for (const field of fields) {
    if (field.wire !== 2 || !(field.value instanceof Uint8Array)) continue;
    // 不往正文、号码等字符串字段里递归，避免把文本误认成 protobuf。
    if ([5, 6, 12, 16].includes(field.number)) continue;
    try {
      const inner = readProtobufFields(field.value);
      collectRecordFields(inner, output, depth + 1);
    } catch {
      // 不是可解析的子消息，忽略
    }
  }
}

function mapMessageType(raw: number | null): SmsMessageType {
  switch (raw) {
    case 1:
      return "inbox";
    case 2:
      return "sent";
    case 3:
      return "draft";
    case 4:
      return "outbox";
    case 5:
      return "failed";
    case 6:
      return "queued";
    default:
      return "unknown";
  }
}

function protobufToMessages(payload: Uint8Array): {
  messages: SmsMessage[];
  skipped: number;
} {
  const root = readProtobufFields(payload);
  const records: Array<ReturnType<typeof readProtobufFields>> = [];
  collectRecordFields(root, records, 0);

  const messages: SmsMessage[] = [];
  let skipped = 0;

  records.forEach((fields, index) => {
    const body = fieldText(fields, 6) ?? "";
    const address = fieldText(fields, 4) ?? "";
    const receivedAt = fieldInt(fields, 7) ?? fieldInt(fields, 11) ?? 0;
    if (!body || !address || !receivedAt) {
      skipped += 1;
      return;
    }

    const sentAtRaw = fieldInt(fields, 11);
    const subject = fieldText(fields, 5);
    const externalId = fieldText(fields, 16);
    const id =
      fieldText(fields, 2) ||
      externalId ||
      `sms-${index}-${address}-${receivedAt}`;

    messages.push({
      id,
      address,
      body,
      subject: subject?.trim() ? subject : null,
      type: mapMessageType(fieldInt(fields, 3)),
      receivedAt,
      sentAt: sentAtRaw && sentAtRaw !== receivedAt ? sentAtRaw : null,
      read: fieldInt(fields, 8) === 1,
      seen: fieldInt(fields, 9) === 1,
      serviceCenter: fieldText(fields, 12),
      externalId,
    });
  });

  messages.sort(
    (a, b) =>
      a.receivedAt - b.receivedAt ||
      a.address.localeCompare(b.address) ||
      a.id.localeCompare(b.id),
  );

  return { messages, skipped };
}

interface DescriptXml {
  packageName: string | null;
  displayName: string | null;
}

function parseDescriptXml(data: Uint8Array): DescriptXml {
  const text = decodeUtf8(data);
  const packageName = text.match(/<packageName>([^<]+)<\/packageName>/)?.[1];
  const displayName = text.match(/<displayName>([^<]+)<\/displayName>/)?.[1];
  return {
    packageName: packageName?.trim() || null,
    displayName: displayName?.trim() || null,
  };
}

function findBackupFile(entries: Array<{ name: string; data: Uint8Array }>): {
  file: { name: string; data: Uint8Array } | null;
  descript: DescriptXml | null;
  warnings: string[];
} {
  const descriptEntry = entries.find((entry) =>
    entry.name.toLowerCase().endsWith("descript.xml"),
  );
  const descript = descriptEntry ? parseDescriptXml(descriptEntry.data) : null;
  const warnings: string[] = [];

  const candidates = entries.filter((entry) => {
    const name = entry.name.toLowerCase();
    return (
      name.endsWith(".bak") ||
      name.includes("com.android.mms") ||
      name.includes("短信")
    );
  });

  const dbEntry = entries.find((entry) =>
    entry.name.toLowerCase().endsWith(".db"),
  );
  if (candidates.length === 0) {
    if (dbEntry) {
      throw new Error(
        "备份里是 SQLite 短信数据库（.db），当前版本暂不支持；请用手机「本地备份」导出短信 .bak 文件",
      );
    }
    throw new Error(
      "ZIP 里没有找到短信备份文件（.bak）；请确认导出的是小米手机「短信」本地备份",
    );
  }

  candidates.sort((a, b) => b.data.length - a.data.length);
  for (const entry of entries) {
    if (entry !== descriptEntry && !candidates.includes(entry)) {
      warnings.push(`已忽略 ZIP 内的其他文件：${entry.name}`);
    }
  }
  return { file: candidates[0] ?? null, descript, warnings };
}

function findTarPayload(entries: Array<{ name: string; data: Uint8Array }>): {
  data: Uint8Array;
  name: string;
} {
  const preferred =
    entries.find((entry) => entry.name.endsWith("_tmp_bak")) ??
    entries.find((entry) => entry.name.includes("miui_bak")) ??
    entries.find((entry) => entry.name.toLowerCase().endsWith(".db"));
  if (!preferred) {
    throw new Error("短信备份 tar 里没有找到 miui_bak/_tmp_bak");
  }
  if (indexOfBytes(preferred.data, SQLITE_MAGIC) === 0) {
    throw new Error(
      "备份里是 SQLite 短信数据库（.db），当前版本暂不支持；请用较新的 MIUI「本地备份」导出短信",
    );
  }
  return { data: preferred.data, name: preferred.name };
}

async function parseBak(data: Uint8Array): Promise<{
  meta: Omit<SmsBackupMeta, "messageCount">;
  messages: SmsMessage[];
  warnings: string[];
}> {
  let header: AndroidBackupHeader;
  try {
    header = parseAndroidBackupHeader(data);
  } catch (error) {
    if (indexOfBytes(data, SQLITE_MAGIC) === 0) {
      throw new Error(
        "这是 SQLite 短信数据库（.db），当前版本只支持 MIUI 的 .bak 备份",
      );
    }
    throw error;
  }

  let payload = data.subarray(header.payloadStart);
  const compressed =
    header.compressed ||
    (payload.length >= 2 &&
      payload[0] === GZIP_MAGIC[0] &&
      payload[1] === GZIP_MAGIC[1]);
  if (compressed) payload = await gunzip(payload);

  const tarEntries = parseTar(payload);
  const tarPayload = findTarPayload(tarEntries);
  const { messages, skipped } = protobufToMessages(tarPayload.data);
  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(`有 ${skipped} 条短信缺少号码/正文/时间，已跳过`);
  }
  if (messages.length === 0) {
    throw new Error("备份里没有解析到短信记录");
  }

  return {
    meta: {
      format: "miui-backup",
      packageName: header.packageName,
      displayName: header.displayName,
      miuiVersion: header.miuiVersion,
      androidBackupVersion: header.version,
      compressed,
    },
    messages,
    warnings,
  };
}

/** 解析小米短信备份：支持 ZIP、.bak、Android Backup，也支持直接传入备份字节 */
export async function parseSmsBackup(
  input: SmsBackupInput,
): Promise<SmsBackup> {
  const data = await toBytesAsync(input);

  if (isZip(data)) {
    const entries = await readZip(data);
    const { file, descript, warnings } = findBackupFile(entries);
    if (!file) throw new Error("ZIP 里没有短信备份文件");
    const parsed = await parseBak(file.data);
    const meta: SmsBackupMeta = {
      ...parsed.meta,
      packageName:
        parsed.meta.packageName ?? descript?.packageName ?? "com.android.mms",
      displayName: parsed.meta.displayName ?? descript?.displayName ?? "短信",
      messageCount: parsed.messages.length,
    };
    return {
      meta,
      messages: parsed.messages,
      warnings: [...warnings, ...parsed.warnings],
    };
  }

  if (
    data.length >= 2 &&
    data[0] === GZIP_MAGIC[0] &&
    data[1] === GZIP_MAGIC[1]
  ) {
    const unzipped = await gunzip(data);
    const parsed = await parseBak(unzipped);
    return {
      meta: { ...parsed.meta, messageCount: parsed.messages.length },
      messages: parsed.messages,
      warnings: parsed.warnings,
    };
  }

  if (indexOfBytes(data, SQLITE_MAGIC) === 0) {
    throw new Error(
      "这是 SQLite 短信数据库（.db），当前版本只支持 MIUI 的 .bak 备份",
    );
  }

  const parsed = await parseBak(data);
  return {
    meta: { ...parsed.meta, messageCount: parsed.messages.length },
    messages: parsed.messages,
    warnings: parsed.warnings,
  };
}

/** 备用导出：解析 tar 数据（一般调用 parseSmsBackup 即可） */
export function parseAndroidBackupTar(data: Uint8Array): SmsMessage[] {
  const entries = parseTar(data);
  const payload = findTarPayload(entries);
  return protobufToMessages(payload.data).messages;
}
