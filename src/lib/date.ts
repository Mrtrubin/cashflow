// 日期工具：一律使用本地时区，日期以 YYYY-MM-DD 字符串存储，避免时区偏移

export interface YearMonth {
  year: number;
  month: number; // 1–12
}

const WEEKDAYS_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地日期 → 'YYYY-MM-DD' */
export function toDateISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toDateISO(new Date());
}

/** 当前时刻的 ISO 字符串（createdAt / updatedAt 统一格式） */
export function nowIso(): string {
  return new Date().toISOString();
}

export function shiftDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return toDateISO(date);
}

export function ymOf(iso: string): YearMonth {
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month: m };
}

export function currentYm(): YearMonth {
  return ymOf(todayISO());
}

export function ymToKey(ym: YearMonth): string {
  return `${ym.year}-${pad(ym.month)}`;
}

export function ymShift(ym: YearMonth, delta: number): YearMonth {
  const date = new Date(ym.year, ym.month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** 'YYYY-MM' 或 'YYYY' */
export function ymKeyToRange(key: string): { from: string; to: string } {
  if (/^\d{4}$/.test(key)) {
    return { from: `${key}-01-01`, to: `${key}-12-31` };
  }
  const [y, m] = key.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${`${key}-01-01`.slice(0, 8)}01`,
    to: `${y}-${pad(m)}-${pad(last)}`,
  };
}

export function daysInRange(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const start = new Date(y1, m1 - 1, d1).getTime();
  const end = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

/** 10月21日 周二 */
export function formatDateCn(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAYS_CN[new Date(y, m - 1, d).getDay()];
  const isToday = iso === todayISO();
  const isYesterday = iso === shiftDaysISO(todayISO(), -1);
  const label = isToday ? "今天" : isYesterday ? "昨天" : `${m}月${d}日`;
  return `${label} ${weekday}`;
}

export function formatYmCn(ym: YearMonth): string {
  return `${ym.year}年${ym.month}月`;
}

/** 时间戳 → 本地 'YYYY-MM-DD HH:mm'（createdAt 等存的是 UTC，展示必须转本地） */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16).replace("T", " ");
  return `${toDateISO(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
