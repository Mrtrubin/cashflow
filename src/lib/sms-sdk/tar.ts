// 极简 tar 读取。Android Backup 的负载是 tar；MIUI 的短信内容在
// apps/com.android.mms/miui_bak/_tmp_bak 这个文件里。

import { decodeUtf8 } from "./binary";

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

function readString(header: Uint8Array, start: number, length: number): string {
  const slice = header.subarray(start, start + length);
  let end = slice.indexOf(0);
  if (end < 0) end = slice.length;
  return decodeUtf8(slice.subarray(0, end)).trim();
}

function readOctal(header: Uint8Array, start: number, length: number): number {
  const text = readString(header, start, length).replace(/\0/g, "").trim();
  if (!text) return 0;
  // GNU base-256 变体：最高位为 1
  if (header[start] & 0x80) {
    let value = 0;
    for (let i = start + 1; i < start + length; i++) {
      value = value * 256 + header[i];
    }
    return value;
  }
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

function parsePax(data: Uint8Array): Record<string, string> {
  const text = decodeUtf8(data);
  const record: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const length = Number(line.slice(0, space));
    if (!Number.isFinite(length) || length <= 0) continue;
    const body = line.slice(space + 1);
    const equals = body.indexOf("=");
    if (equals < 0) continue;
    record[body.slice(0, equals)] = body.slice(equals + 1);
  }
  return record;
}

export function parseTar(data: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let nextName: string | null = null;
  let nextPax: Record<string, string> = {};

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (isZeroBlock(header)) break;

    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (nextPax.path) name = nextPax.path;
    if (nextName) name = nextName;

    const size = nextPax.size
      ? Number(nextPax.size) || 0
      : readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > data.length) break;
    const content = data.subarray(dataStart, dataEnd);

    if (type === "x") {
      nextPax = parsePax(content);
    } else if (type === "g") {
      // 全局 pax 头，忽略即可
    } else if (type === "L") {
      nextName = decodeUtf8(content).replace(/\0/g, "").trim();
    } else if (type === "0" || type === "\0" || type === "7") {
      entries.push({ name, data: content });
      nextName = null;
      nextPax = {};
    } else {
      // 目录、链接等其它类型对短信备份没有用处
      nextName = null;
      nextPax = {};
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}
