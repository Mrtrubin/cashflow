// 零依赖 ZIP 读取：只支持短信备份里常见的 store / deflate 两种压缩方式。
// 使用浏览器与 Node 都有的 DecompressionStream("deflate-raw") 解压。

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  compressedSize: number;
  uncompressedSize: number;
}

const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readU64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x1_0000_0000 + low;
}

interface Zip64Extra {
  uncompressedSize?: number;
  compressedSize?: number;
  localOffset?: number;
}

/** 解析 0x0001 ZIP64 扩展字段；值只出现被写为 0xffffffff/0xffff 的项 */
function parseZip64Extra(
  extra: Uint8Array,
  needUncompressed: boolean,
  needCompressed: boolean,
  needOffset: boolean,
): Zip64Extra {
  const result: Zip64Extra = {};
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = readU16(view, offset);
    const size = readU16(view, offset + 2);
    offset += 4;
    if (id === 0x0001) {
      let cursor = offset;
      if (needUncompressed && cursor + 8 <= offset + size) {
        result.uncompressedSize = readU64(view, cursor);
        cursor += 8;
      }
      if (needCompressed && cursor + 8 <= offset + size) {
        result.compressedSize = readU64(view, cursor);
        cursor += 8;
      }
      if (needOffset && cursor + 8 <= offset + size) {
        result.localOffset = readU64(view, cursor);
      }
      break;
    }
    offset += size;
  }
  return result;
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const min = Math.max(0, data.length - 65_557);
  for (let i = data.length - 22; i >= min; i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gbk").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前环境不支持 ZIP 解压（DecompressionStream）");
  }
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isZip(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)
  );
}

export async function readZip(data: Uint8Array): Promise<ZipEntry[]> {
  if (!isZip(data)) throw new Error("不是 ZIP 文件");
  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new Error("ZIP 文件缺少中央目录");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const entryCount = readU16(view, eocd + 10);
  let centralOffset = readU32(view, eocd + 16);
  let totalEntries = entryCount;
  if (centralOffset === 0xffffffff || entryCount === 0xffff) {
    // ZIP64 EOCD locator：签名 0x07064b50，紧挨着普通 EOCD
    const locator = eocd - 20;
    if (locator < 0 || readU32(view, locator) !== 0x07064b50) {
      throw new Error("ZIP64 中央目录定位失败");
    }
    const zip64Offset = readU64(view, locator + 8);
    if (readU32(view, zip64Offset) !== 0x06064b50) {
      throw new Error("ZIP64 中央目录头非法");
    }
    totalEntries = readU64(view, zip64Offset + 32);
    centralOffset = readU64(view, zip64Offset + 48);
  }
  if (centralOffset > data.length) throw new Error("ZIP 中央目录偏移非法");

  const entries: ZipEntry[] = [];
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > data.length) break;
    if (readU32(view, offset) !== CENTRAL_SIGNATURE) break;

    const flags = readU16(view, offset + 8);
    const method = readU16(view, offset + 10);
    const rawCompressedSize = readU32(view, offset + 20);
    const rawUncompressedSize = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const rawLocalOffset = readU32(view, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const extraStart = nameEnd;
    const extraEnd = extraStart + extraLength;
    const name = decodeName(
      data.subarray(nameStart, nameEnd),
      (flags & 0x800) !== 0,
    );
    const zip64 = parseZip64Extra(
      data.subarray(extraStart, extraEnd),
      rawUncompressedSize === 0xffffffff,
      rawCompressedSize === 0xffffffff,
      rawLocalOffset === 0xffffffff,
    );
    const uncompressedSize = zip64.uncompressedSize ?? rawUncompressedSize;
    const compressedSize = zip64.compressedSize ?? rawCompressedSize;
    const localOffset = zip64.localOffset ?? rawLocalOffset;
    offset = extraEnd + commentLength;

    if (localOffset + 30 > data.length) continue;
    if (readU32(view, localOffset) !== LOCAL_SIGNATURE) continue;
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.subarray(dataStart, dataStart + compressedSize);

    let content: Uint8Array;
    if (method === 0) {
      content = compressed;
    } else if (method === 8) {
      content = await inflateRaw(compressed);
    } else {
      throw new Error(`ZIP 条目「${name}」使用了不支持的压缩方式 ${method}`);
    }

    entries.push({
      name,
      data: content,
      compressedSize,
      uncompressedSize,
    });
  }

  return entries;
}
