// 极简二进制 / protobuf 读取工具。
// 只服务于 MIUI 短信备份，不追求覆盖 protobuf 的全部特性。

const textDecoder = new TextDecoder("utf-8", { fatal: false });

export function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from = 0,
): number {
  if (needle.length === 0) return from;
  outer: for (
    let i = Math.max(0, from);
    i <= haystack.length - needle.length;
    i++
  ) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前环境不支持解压（DecompressionStream）");
  }
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export interface ProtobufField {
  number: number;
  wire: number;
  value: number | Uint8Array;
}

/**
 * 读取一个 varint。
 * 短信里需要精确读取的字段（时间戳）都在 2^42 以内；更长的 varint
 * （例如 -1 被编码成 10 字节）只用来跳过，返回 MAX_SAFE_INTEGER。
 */
export function readVarint(
  data: Uint8Array,
  start: number,
): { value: number; next: number } {
  let result = 0;
  let factor = 1;
  let index = start;

  for (let count = 0; count < 10; count++) {
    if (index >= data.length) throw new Error("protobuf varint 被截断");
    const byte = data[index];
    index += 1;
    if (count < 6) {
      result += (byte & 0x7f) * factor;
    }
    if ((byte & 0x80) === 0) {
      return {
        value: count < 6 ? result : Number.MAX_SAFE_INTEGER,
        next: index,
      };
    }
    factor *= 128;
  }

  throw new Error("protobuf varint 过长");
}

/** 读取一条消息的所有字段；遇到组（wire 3/4）直接结束 */
export function readProtobufFields(data: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let index = 0;
  while (index < data.length) {
    const key = readVarint(data, index);
    index = key.next;
    const fieldNumber = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (fieldNumber <= 0) break;

    if (wire === 0) {
      const value = readVarint(data, index);
      index = value.next;
      fields.push({ number: fieldNumber, wire, value: value.value });
    } else if (wire === 1) {
      if (index + 8 > data.length) break;
      fields.push({
        number: fieldNumber,
        wire,
        value: data.subarray(index, index + 8),
      });
      index += 8;
    } else if (wire === 2) {
      const length = readVarint(data, index);
      index = length.next;
      const size = length.value;
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        index + size > data.length
      ) {
        break;
      }
      fields.push({
        number: fieldNumber,
        wire,
        value: data.subarray(index, index + size),
      });
      index += size;
    } else if (wire === 5) {
      if (index + 4 > data.length) break;
      const view = new DataView(data.buffer, data.byteOffset + index, 4);
      fields.push({
        number: fieldNumber,
        wire,
        value: view.getUint32(0, true),
      });
      index += 4;
    } else {
      // wire 3/4 是已废弃的 group；短信备份里不会出现。
      break;
    }
  }
  return fields;
}

export function fieldBytes(
  fields: ProtobufField[],
  number: number,
): Uint8Array | null {
  const field = fields.find(
    (item) => item.number === number && item.wire === 2,
  );
  return field && field.value instanceof Uint8Array ? field.value : null;
}

export function fieldText(
  fields: ProtobufField[],
  number: number,
): string | null {
  const bytes = fieldBytes(fields, number);
  return bytes ? decodeUtf8(bytes) : null;
}

export function fieldInt(
  fields: ProtobufField[],
  number: number,
): number | null {
  const field = fields.find(
    (item) => item.number === number && item.wire === 0,
  );
  return field && typeof field.value === "number" ? field.value : null;
}
