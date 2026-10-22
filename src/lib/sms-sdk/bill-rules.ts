// 账单短信识别规则。
//
// 设计原则：
//   * 先匹配结构明确的银行规则（工行、中行、杭州银行等），再走通用银行规则；
//   * 只认「有账户/卡号 + 有金额 + 有交易动作」的短信，账单提醒、验证码、
//     营销短信、手机话费月账单都不算；
//   * 输出统一的 SmsBillTransaction，应用层只负责映射账户/分类。

import type {
  SmsBillRule,
  SmsBillRuleContext,
  SmsBillRuleMatch,
  SmsBillTransaction,
  SmsMessage,
} from "./types";

const DAY_MS = 86_400_000;

const BANK_BY_ADDRESS: Record<string, string> = {
  "95588": "工商银行",
  "95566": "中国银行",
  "95533": "建设银行",
  "95599": "农业银行",
  "95555": "招商银行",
  "95511": "平安银行",
  "95561": "兴业银行",
  "95528": "浦发银行",
  "95568": "民生银行",
  "95595": "光大银行",
  "95577": "华夏银行",
  "95559": "交通银行",
  "95508": "广发银行",
  "95398": "杭州银行",
  "95316": "宁波银行",
  "95580": "邮储银行",
};

const BANK_ALIASES: Record<string, string> = {
  中国工商银行: "工商银行",
  工商银行: "工商银行",
  中国银行: "中国银行",
  中国建设银行: "建设银行",
  建设银行: "建设银行",
  中国农业银行: "农业银行",
  农业银行: "农业银行",
  中国邮政储蓄银行: "邮储银行",
  邮政储蓄银行: "邮储银行",
  邮储银行: "邮储银行",
  招商银行: "招商银行",
  平安银行: "平安银行",
  兴业银行: "兴业银行",
  浦发银行: "浦发银行",
  上海浦东发展银行: "浦发银行",
  民生银行: "民生银行",
  中国民生银行: "民生银行",
  光大银行: "光大银行",
  中国光大银行: "光大银行",
  华夏银行: "华夏银行",
  交通银行: "交通银行",
  广发银行: "广发银行",
  杭州银行: "杭州银行",
  宁波银行: "宁波银行",
};

const CHANNELS = [
  "财付通",
  "支付宝",
  "微信支付",
  "微信",
  "网银在线",
  "银联",
  "云闪付",
  "美团支付",
  "抖音支付",
  "京东支付",
  "京东金融",
  "拼多多",
  "苏宁支付",
  "快钱",
  "易宝支付",
  "快捷支付",
] as const;

const FLOW_WORDS = [
  "金融付款",
  "消费",
  "充值",
  "还款",
  "转账",
  "缴费",
  "退款",
  "存入",
  "转出",
  "转入",
  "取现",
  "取款",
  "提现",
  "收入",
  "支出",
] as const;

const VERIFICATION_PATTERN =
  /验证码|校验码|动态码|交易码|短信编号|手机交易码|授权码/;

const STATEMENT_PATTERN =
  /本期账单|账单已还清|最低还款|到期还款日|尚未全额还款|应还(?:金额|人民币)?|还需[^。；;]{0,20}还清/;

const MARKETING_PATTERN =
  /活动|返现|领取|名额|优惠|红包|点击|退订|回复R|拒收|最高|即可|福利|立减|折扣|抽奖|赠送/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeSmsText(input: string): string {
  let result = "";
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += char;
    }
  }
  return result
    .replace(/\u3000/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function amountToCents(input: string | undefined | null): number | null {
  if (!input) return null;
  const normalized = input.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [integer, decimal = ""] = normalized.split(".");
  const cents = Number(integer) * 100 + Number(`${decimal}00`.slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

interface DateParts {
  year?: number;
  month?: number;
  day: number;
  hour?: number;
  minute?: number;
}

interface DateResult {
  date: string;
  time: string;
}

function makeDate(parts: DateParts): Date | null {
  const date = new Date(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
  );
  if (
    date.getFullYear() !== (parts.year ?? 1970) ||
    date.getMonth() !== (parts.month ?? 1) - 1 ||
    date.getDate() !== parts.day
  ) {
    return null;
  }
  return date;
}

/** 把短信里的月日/时间补成完整日期；缺年份时按收到时间推断 */
function resolveDate(parts: DateParts, receivedAt: number): DateResult | null {
  const received = new Date(receivedAt);
  const baseYear = received.getFullYear();
  const hour = parts.hour ?? received.getHours();
  const minute = parts.minute ?? received.getMinutes();
  const fallbackTime = `${pad2(hour)}:${pad2(minute)}`;

  if (parts.month == null) {
    let year = baseYear;
    let month = received.getMonth() + 1;
    let candidate = makeDate({ ...parts, year, month, hour, minute });
    if (!candidate) return null;
    if (candidate.getTime() > receivedAt + 2 * DAY_MS) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      candidate =
        makeDate({ ...parts, year, month, hour, minute }) ?? candidate;
    }
    return {
      date: `${candidate.getFullYear()}-${pad2(candidate.getMonth() + 1)}-${pad2(
        candidate.getDate(),
      )}`,
      time: fallbackTime,
    };
  }

  let year = parts.year ?? baseYear;
  let candidate = makeDate({ ...parts, year, hour, minute });
  if (!candidate) return null;
  if (candidate.getTime() > receivedAt + 2 * DAY_MS) {
    year -= 1;
    candidate = makeDate({ ...parts, year, hour, minute }) ?? candidate;
  }
  return {
    date: `${candidate.getFullYear()}-${pad2(candidate.getMonth() + 1)}-${pad2(
      candidate.getDate(),
    )}`,
    time: fallbackTime,
  };
}

function extractDate(body: string, receivedAt: number): DateResult {
  const received = new Date(receivedAt);
  const fallback = {
    date: `${received.getFullYear()}-${pad2(received.getMonth() + 1)}-${pad2(
      received.getDate(),
    )}`,
    time: `${pad2(received.getHours())}:${pad2(received.getMinutes())}`,
  };

  const full = body.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})[:：时](\d{2})分?)?/,
  );
  if (full) {
    const parsed = resolveDate(
      {
        year: Number(full[1]),
        month: Number(full[2]),
        day: Number(full[3]),
        hour: full[4] != null ? Number(full[4]) : undefined,
        minute: full[5] != null ? Number(full[5]) : undefined,
      },
      receivedAt,
    );
    if (parsed) return parsed;
  }

  const dashed = body.match(
    /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/,
  );
  if (dashed) {
    const parsed = resolveDate(
      {
        year: Number(dashed[1]),
        month: Number(dashed[2]),
        day: Number(dashed[3]),
        hour: dashed[4] != null ? Number(dashed[4]) : undefined,
        minute: dashed[5] != null ? Number(dashed[5]) : undefined,
      },
      receivedAt,
    );
    if (parsed) return parsed;
  }

  const monthDay = body.match(
    /(\d{1,2})月(\d{1,2})日\s*(?:(\d{1,2})[:：时](\d{2})分?)?/,
  );
  if (monthDay) {
    const parsed = resolveDate(
      {
        month: Number(monthDay[1]),
        day: Number(monthDay[2]),
        hour: monthDay[3] != null ? Number(monthDay[3]) : undefined,
        minute: monthDay[4] != null ? Number(monthDay[4]) : undefined,
      },
      receivedAt,
    );
    if (parsed) return parsed;
  }

  const dayOnly = body.match(/(\d{1,2})日\s*(\d{1,2})[:：](\d{2})/);
  if (dayOnly) {
    const parsed = resolveDate(
      {
        day: Number(dayOnly[1]),
        hour: Number(dayOnly[2]),
        minute: Number(dayOnly[3]),
      },
      receivedAt,
    );
    if (parsed) return parsed;
  }

  return fallback;
}

function normalizeBankName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[【】[\]]/g, "").trim();
  return BANK_ALIASES[cleaned] ?? cleaned;
}

function parseBankName(body: string, address: string): string | null {
  const named =
    body.match(/【([^】]{2,20})】/) ?? body.match(/\[([^\]]{2,20})\]/);
  if (named) {
    const normalized = normalizeBankName(named[1]);
    if (normalized?.endsWith("银行")) return normalized;
  }
  const fullName = body.match(
    /(?:中国工商银行|中国建设银行|中国农业银行|中国银行|中国邮政储蓄银行|邮政储蓄银行|工商银行|建设银行|农业银行|招商银行|平安银行|兴业银行|浦发银行|民生银行|光大银行|华夏银行|交通银行|广发银行|杭州银行|宁波银行)/,
  );
  if (fullName) return normalizeBankName(fullName[0]);
  return BANK_BY_ADDRESS[address] ?? null;
}

interface CardInfo {
  tail: string | null;
  type: "credit" | "debit" | null;
}

function parseCardInfo(body: string): CardInfo {
  const tailMatch =
    body.match(
      /(?:尾号|卡号后四位|卡号末四位|卡号|账号|账户)\s*(?:为|是)?\s*[：:]?\s*(\d{4})(?!\d)/,
    ) ?? body.match(/信用卡\s*(\d{4})(?!\d)/);
  const type = /信用卡/.test(body)
    ? "credit"
    : /借记卡|储蓄卡|西湖卡|一卡通|龙卡/.test(body)
      ? "debit"
      : null;
  return { tail: tailMatch?.[1] ?? null, type };
}

function parseBalance(body: string): number | null {
  const match = body.match(
    /(?:余额|账户余额|活期余额|可用余额)\s*(?:为|是)?\s*[：:]?\s*(?:人民币|RMB|CNY|¥|￥)?\s*([\d,]+(?:\.\d{1,2})?)/,
  );
  return amountToCents(match?.[1]);
}

interface FlowParts {
  flow: string | null;
  channel: string | null;
  merchant: string | null;
}

function cleanMerchant(raw: string): string | null {
  let value = raw
    .replace(/^[\s\-－—_:：|]+/, "")
    .replace(/[\s\-－—_:：|。]+$/, "")
    .replace(/(?:人民币|RMB|CNY|成功|交易)$/g, "")
    .trim();
  if (value.startsWith("(") && value.endsWith(")")) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return null;
  if (/^[\d,.\s]+$/.test(value)) return null;
  if (value.length > 60) value = value.slice(0, 60);
  return value || null;
}

function findChannel(text: string): string | null {
  for (const channel of CHANNELS) {
    if (text.includes(channel)) return channel;
  }
  return null;
}

function splitFlowContent(rawContent: string): FlowParts {
  let content = rawContent.trim();
  if (content.startsWith("(") && content.endsWith(")")) {
    content = content.slice(1, -1).trim();
  }
  if (!content) return { flow: null, channel: null, merchant: null };

  const flow = FLOW_WORDS.find((word) => content.startsWith(word)) ?? null;
  let rest = flow ? content.slice(flow.length) : content;
  rest = rest.replace(/^[\s\-－—_:：|]+/, "");

  let channel = findChannel(rest);
  if (!channel) {
    // 「微信零钱提现财付通」这种渠道写在末尾的写法
    channel = findChannel(content);
  }

  if (channel) {
    rest = rest.replace(channel, "");
  }
  rest = rest.replace(/^[\s\-－—_:：|]+/, "");

  let merchant = cleanMerchant(rest);
  if (!merchant && channel)
    merchant = cleanMerchant(content.replace(channel, ""));

  const inferredFlow =
    flow ??
    (content.includes("提现")
      ? "提现"
      : content.includes("入账")
        ? "入账"
        : content.includes("退款")
          ? "退款"
          : null);

  return { flow: inferredFlow, channel, merchant };
}

function buildNote(
  flow: string | null,
  channel: string | null,
  merchant: string | null,
  fallback: string,
): string {
  if (merchant) {
    if (flow && channel) return `${flow}${channel}-${merchant}`;
    if (flow) return `${flow}${merchant}`;
    if (channel) return `${channel}-${merchant}`;
    return merchant;
  }
  if (flow && channel) return `${flow}${channel}`;
  return flow ?? channel ?? fallback;
}

function suggestCategory(
  kind: "expense" | "income",
  merchant: string | null,
  flow: string | null,
  channel: string | null,
): string {
  const text = `${flow ?? ""} ${merchant ?? ""} ${channel ?? ""}`;

  if (kind === "income") {
    if (
      /工资|薪|学生处|补助|资助|资学金|奖学金|助学金|奖金|劳务|课酬|津贴/.test(
        text,
      )
    )
      return "工资";
    if (/见习|实习|兼职/.test(text)) return "兼职";
    if (/利息|分红|理财|基金|余额宝/.test(text)) return "理财";
    if (/退款|退货/.test(text)) return "其他";
    return "其他";
  }

  if (/还款|白条|月付|花呗|信用卡/.test(text)) return "其他";
  if (/转账|红包|群收款|请客|礼金|份子|面对面收款|收款/.test(text))
    return "人情";
  if (
    /铁路|火车|航空|航旅|出行|滴滴|地铁|公交|打车|加油|停车|高速|天府通|哈啰/.test(
      text,
    )
  )
    return "交通";
  if (/药|医院|诊所|体检|医疗/.test(text)) return "医疗";
  if (/电影|游戏|腾讯|网吧|KTV|旅行|酒店|会员|视频|音乐|健身|演出/.test(text))
    return "娱乐";
  if (/学费|课程|书籍|教育|培训|学校/.test(text)) return "教育";
  if (
    /物业|水费|电费|燃气|房租|生活缴费|话费|手机充值|宽带|通讯|中国移动|中国联通|中国电信/.test(
      text,
    )
  )
    return "居住";
  if (/超市|便利|美宜佳|唐久|百货|商场|名创|苏宁/.test(text)) return "购物";
  if (/京东|淘宝|拼多多|天猫|商城|旗舰店|自营|京喜|礼品卡|购物/.test(text))
    return "购物";
  if (
    /餐|饭|食|小吃|面|粉|汉堡|麻辣烫|咖啡|奶茶|蜜雪|塔斯汀|老乡鸡|沙县|拌面|炒鸡|焗饭|咖喱|蛋包饭|烧鸡|烤鸡|饺子|粥|零嘴/.test(
      text,
    )
  )
    return "餐饮";
  return "其他";
}

function accountHintFor(
  bank: string | null,
  cardTail: string | null,
  channel: string | null,
): string | null {
  if (bank) return `${bank}${cardTail ?? ""}`;
  if (channel) return channel;
  return null;
}

function tagsFor(
  bank: string | null,
  cardTail: string | null,
  channel: string | null,
): string[] {
  const tags: string[] = [];
  if (bank) tags.push(bank);
  if (cardTail) tags.push(`尾号${cardTail}`);
  if (channel && channel !== bank) tags.push(channel);
  return [...new Set(tags)];
}

function finalizeTransaction(
  context: SmsBillRuleContext,
  match: SmsBillRuleMatch,
  ruleId: string,
): SmsBillTransaction | null {
  const amountCents = match.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date)) return null;

  const received = new Date(context.receivedAt);
  const receivedDate = `${received.getFullYear()}-${pad2(
    received.getMonth() + 1,
  )}-${pad2(received.getDate())}`;
  const date =
    match.date > receivedDate &&
    new Date(`${match.date}T00:00:00`).getTime() >
      context.receivedAt + 3 * DAY_MS
      ? receivedDate
      : match.date;

  const time =
    match.time && /^\d{2}:\d{2}$/.test(match.time)
      ? match.time
      : `${pad2(received.getHours())}:${pad2(received.getMinutes())}`;

  const bank = normalizeBankName(match.bank ?? null);
  const channel = match.channel ?? null;
  const merchant = match.merchant ?? null;
  const flow = match.flow ?? null;
  const note =
    match.note ??
    buildNote(flow, channel, merchant, bank ?? context.message.address);

  return {
    messageId: context.message.id,
    receivedAt: context.receivedAt,
    date,
    time,
    kind: match.kind,
    amountCents,
    balanceCents: match.balanceCents ?? null,
    bank,
    cardTail: match.cardTail ?? null,
    cardType: match.cardType ?? null,
    flow,
    channel,
    merchant,
    note,
    categoryHint:
      match.categoryHint ??
      suggestCategory(match.kind, merchant, flow, channel),
    accountHint:
      match.accountHint ??
      accountHintFor(bank, match.cardTail ?? null, channel),
    tags: [
      ...new Set(match.tags ?? tagsFor(bank, match.cardTail ?? null, channel)),
    ],
    raw: context.message.body,
    address: context.message.address,
    confidence: match.confidence ?? 0.8,
    ruleId,
  };
}

/** 工商银行：尾号2454卡10月14日20:06支出(转账财付通-微信转账)15元，余额10,247.24元 */
const ICBC_RULE: SmsBillRule = {
  id: "icbc",
  description: "工商银行借记卡收支短信",
  match: (context) => {
    const match = context.body.match(
      /(?:尾号|尾号为)\s*(\d{4})\s*卡\s*(?:(\d{1,2})月)?(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*(?:快捷支付|网上银行|手机银行|工商银行|银行|ATM|自助终端|柜面|柜台)?\s*(支出|收入)\s*\((.+)\)\s*([\d,]+(?:\.\d{1,2})?)\s*元(?:\s*[，,]\s*余额\s*([\d,]+(?:\.\d{1,2})?)\s*元)?/,
    );
    if (!match) return null;
    const amountCents = amountToCents(match[8]);
    if (!amountCents) return null;

    const parsedDate = resolveDate(
      {
        month: match[2] != null ? Number(match[2]) : undefined,
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
      },
      context.receivedAt,
    );
    if (!parsedDate) return null;

    const content = match[7].trim();
    const parts = splitFlowContent(content);
    const kind = match[6] === "收入" ? "income" : "expense";
    const bank = "工商银行";
    const cardTail = match[1];
    const counterparty = context.body.match(
      /对方户名[：:]\s*([^，,。]+)(?:[，,]\s*对方账户尾号[：:]\s*(\d{4}))?/,
    );
    const note =
      parts.merchant && content
        ? content
        : counterparty
          ? `对方户名：${counterparty[1]}`
          : `${bank}${kind === "income" ? "收入" : "支出"}`;

    return {
      kind,
      amountCents,
      balanceCents: amountToCents(match[9]),
      date: parsedDate.date,
      time: parsedDate.time,
      bank,
      cardTail,
      cardType: /信用卡/.test(context.body) ? "credit" : null,
      flow: parts.flow,
      channel: parts.channel,
      merchant: parts.merchant,
      note: note || (counterparty ? `对方户名：${counterparty[1]}` : null),
      categoryHint: suggestCategory(
        kind,
        parts.merchant,
        parts.flow,
        parts.channel,
      ),
      accountHint: accountHintFor(bank, cardTail, parts.channel),
      tags: tagsFor(bank, cardTail, parts.channel),
      confidence: 0.98,
    };
  },
};

/** 中国银行：您的信用卡0181于2026年10月21日首次交易RMB40.00元成功 */
const BOC_FIRST_TRANSACTION_RULE: SmsBillRule = {
  id: "boc-first-transaction",
  description: "中国银行信用卡首次交易",
  match: (context) => {
    const match = context.body.match(
      /您的信用卡\s*(\d{4})\s*于\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*首次交易\s*(?:RMB|人民币|CNY|¥|￥)?\s*([\d,]+(?:\.\d{1,2})?)\s*元\s*成功/,
    );
    if (!match) return null;
    const amountCents = amountToCents(match[5]);
    if (!amountCents) return null;
    const parsedDate = resolveDate(
      {
        year: Number(match[2]),
        month: Number(match[3]),
        day: Number(match[4]),
      },
      context.receivedAt,
    );
    if (!parsedDate) return null;
    const cardTail = match[1];
    return {
      kind: "expense",
      amountCents,
      date: parsedDate.date,
      time: parsedDate.time,
      bank: "中国银行",
      cardTail,
      cardType: "credit",
      flow: "消费",
      channel: null,
      merchant: null,
      note: "信用卡首次交易",
      categoryHint: "其他",
      accountHint: accountHintFor("中国银行", cardTail, null),
      tags: tagsFor("中国银行", cardTail, null),
      confidence: 0.95,
    };
  },
};

/** 杭州银行：您尾号1586西湖卡08月12日17:59转账存入521.74元(杭州见习)，余额522.74。 */
const HANGZHOU_RULE: SmsBillRule = {
  id: "hangzhou-bank",
  description: "杭州银行西湖卡收支短信",
  match: (context) => {
    const match = context.body.match(
      /【杭州银行】\s*您尾号\s*(\d{4})\s*[^0-9]{0,8}卡?\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*(转账存入|存入|收入|转出|支出|消费)\s*(?:人民币|RMB)?\s*([\d,]+(?:\.\d{1,2})?)\s*元?\s*(?:\(([^)]*)\))?[，,]\s*余额\s*([\d,]+(?:\.\d{1,2})?)/,
    );
    if (!match) return null;
    const amountCents = amountToCents(match[7]);
    if (!amountCents) return null;
    const parsedDate = resolveDate(
      {
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
      },
      context.receivedAt,
    );
    if (!parsedDate) return null;
    const action = match[6];
    const kind = /存入|收入/.test(action) ? "income" : "expense";
    const merchant = cleanMerchant(match[8] ?? "");
    const cardTail = match[1];
    return {
      kind,
      amountCents,
      balanceCents: amountToCents(match[9]),
      date: parsedDate.date,
      time: parsedDate.time,
      bank: "杭州银行",
      cardTail,
      cardType: "debit",
      flow: /存入/.test(action) ? "存入" : action,
      channel: null,
      merchant,
      note: merchant ?? action,
      categoryHint: suggestCategory(kind, merchant, action, null),
      accountHint: accountHintFor("杭州银行", cardTail, null),
      tags: tagsFor("杭州银行", cardTail, null),
      confidence: 0.97,
    };
  },
};

/** 微信支付：付款成功 / 退款已受理（没有银行卡信息，作为钱包账单） */
const WECHAT_PAY_RULE: SmsBillRule = {
  id: "wechat-pay",
  description: "微信支付付款成功短信",
  wallet: true,
  match: (context) => {
    const match = context.body.match(
      /【微信支付】.*?(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*付款成功\s*(?:人民币|RMB)?\s*([\d,]+(?:\.\d{1,2})?)\s*元/,
    );
    if (!match) return null;
    const amountCents = amountToCents(match[6]);
    if (!amountCents) return null;
    const parsedDate = resolveDate(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
      },
      context.receivedAt,
    );
    if (!parsedDate) return null;
    return {
      kind: "expense",
      amountCents,
      date: parsedDate.date,
      time: parsedDate.time,
      bank: null,
      cardTail: null,
      cardType: null,
      flow: "付款",
      channel: "微信支付",
      merchant: null,
      note: "微信支付",
      categoryHint: "其他",
      accountHint: "微信",
      tags: ["微信支付"],
      confidence: 0.8,
    };
  },
};

const WECHAT_REFUND_RULE: SmsBillRule = {
  id: "wechat-refund",
  description: "微信支付退款受理短信",
  wallet: true,
  match: (context) => {
    const match = context.body.match(
      /【微信支付】\s*退款已受理.*?退款金额\s*(?:人民币|RMB)?\s*([\d,]+(?:\.\d{1,2})?)\s*元/,
    );
    if (!match) return null;
    const amountCents = amountToCents(match[1]);
    if (!amountCents) return null;
    const parsedDate = extractDate(context.body, context.receivedAt);
    return {
      kind: "income",
      amountCents,
      date: parsedDate.date,
      time: parsedDate.time,
      bank: null,
      cardTail: null,
      cardType: null,
      flow: "退款",
      channel: "微信支付",
      merchant: null,
      note: "微信支付退款",
      categoryHint: "其他",
      accountHint: "微信",
      tags: ["微信支付"],
      confidence: 0.7,
    };
  },
};

const ACTION_PATTERN =
  /消费|支出|取现|取款|转出|付款|扣款|还款|退款|收入|存入|转入|入账/;

/** 通用银行规则：尾号/卡号 + 收支动作 + 金额 */
const GENERIC_BANK_RULE: SmsBillRule = {
  id: "generic-bank",
  description: "通用银行收支短信",
  match: (context) => {
    const body = context.body;
    if (STATEMENT_PATTERN.test(body)) return null;
    if (MARKETING_PATTERN.test(body)) return null;
    const bank = parseBankName(body, context.message.address);
    const card = parseCardInfo(body);
    if (!bank && !card.tail) return null;
    if (!card.tail) return null;

    const actionMatch = body.match(ACTION_PATTERN);
    if (!actionMatch || actionMatch.index == null) return null;
    const action = actionMatch[0];
    const actionIndex = actionMatch.index;
    const afterAction = body.slice(actionIndex + action.length);

    const amountMatch = afterAction.match(
      /(?:人民币|RMB|CNY|¥|￥)?\s*([\d,]+(?:\.\d{1,2})?)\s*元/,
    );
    if (!amountMatch) return null;
    const amountCents = amountToCents(amountMatch[1]);
    if (!amountCents) return null;

    const kind: "expense" | "income" = /收入|存入|转入|入账|退款/.test(action)
      ? "income"
      : "expense";
    if (card.type === "credit" && /还款|存入/.test(action)) return null;

    const parsedDate = extractDate(body, context.receivedAt);
    const segment = afterAction.slice(0, amountMatch.index ?? 0);
    const parts = splitFlowContent(`${action}${segment}`);
    const balance = parseBalance(body);
    const flow = parts.flow ?? action;
    const merchant = parts.merchant;
    const channel = parts.channel;
    return {
      kind,
      amountCents,
      balanceCents: balance,
      date: parsedDate.date,
      time: parsedDate.time,
      bank,
      cardTail: card.tail,
      cardType: card.type,
      flow,
      channel,
      merchant,
      note: buildNote(flow, channel, merchant, bank ?? action),
      categoryHint: suggestCategory(kind, merchant, flow, channel),
      accountHint: accountHintFor(bank, card.tail, channel),
      tags: tagsFor(bank, card.tail, channel),
      confidence: 0.72,
    };
  },
};

/** 内置规则，按优先级从高到低 */
export const SMS_BILL_RULES: readonly SmsBillRule[] = [
  ICBC_RULE,
  BOC_FIRST_TRANSACTION_RULE,
  HANGZHOU_RULE,
  WECHAT_PAY_RULE,
  WECHAT_REFUND_RULE,
  GENERIC_BANK_RULE,
];

function toTimestamp(
  value: Date | number | string | undefined,
  fallback: number,
  endOfDay = false,
): number {
  if (value == null) return fallback;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const start = new Date(year, month - 1, day).getTime();
    return endOfDay ? start + DAY_MS - 1 : start;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 识别单条短信；不是账单时返回 null */
export function parseBillSms(
  message: SmsMessage,
  options: {
    includeSent?: boolean;
    includeWallets?: boolean;
    rules?: readonly SmsBillRule[];
  } = {},
): SmsBillTransaction | null {
  if (
    !options.includeSent &&
    message.type !== "inbox" &&
    message.type !== "unknown"
  ) {
    return null;
  }
  const body = normalizeSmsText(message.body);
  if (!body || body.length < 6) return null;
  if (VERIFICATION_PATTERN.test(body)) return null;
  if (STATEMENT_PATTERN.test(body)) return null;

  const rules = options.rules ?? SMS_BILL_RULES;
  for (const rule of rules) {
    if (options.includeWallets === false && rule.wallet) continue;
    let matched: SmsBillRuleMatch | null | undefined;
    try {
      matched = rule.match({
        message,
        body,
        receivedAt: message.receivedAt,
      });
    } catch {
      matched = null;
    }
    if (!matched) continue;
    const transaction = finalizeTransaction(
      { message, body, receivedAt: message.receivedAt },
      matched,
      rule.id,
    );
    if (transaction) return transaction;
  }
  return null;
}

/** 批量识别账单短信 */
export function extractBillTransactions(
  messages: readonly SmsMessage[],
  options: {
    includeSent?: boolean;
    includeWallets?: boolean;
    since?: Date | number | string;
    until?: Date | number | string;
    dedupeMessages?: boolean;
    rules?: readonly SmsBillRule[];
  } = {},
): {
  transactions: SmsBillTransaction[];
  total: number;
  matched: number;
  skipped: number;
  byBank: Record<string, number>;
} {
  const since = toTimestamp(options.since, Number.NEGATIVE_INFINITY);
  const until = toTimestamp(options.until, Number.POSITIVE_INFINITY, true);
  const dedupe = options.dedupeMessages !== false;
  const seen = new Set<string>();
  const transactions: SmsBillTransaction[] = [];
  let total = 0;

  for (const message of messages) {
    if (message.receivedAt < since || message.receivedAt > until) continue;
    if (
      !options.includeSent &&
      message.type !== "inbox" &&
      message.type !== "unknown"
    ) {
      continue;
    }
    if (dedupe) {
      const key = `${message.address}|${message.receivedAt}|${message.body}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    total += 1;
    const transaction = parseBillSms(message, options);
    if (transaction) transactions.push(transaction);
  }

  transactions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      a.receivedAt - b.receivedAt,
  );

  const byBank: Record<string, number> = {};
  for (const transaction of transactions) {
    const key = transaction.bank ?? transaction.channel ?? "其他";
    byBank[key] = (byBank[key] ?? 0) + 1;
  }

  return {
    transactions,
    total,
    matched: transactions.length,
    skipped: total - transactions.length,
    byBank,
  };
}

/** 暴露给调用方做单测/调试 */
export { extractDate, normalizeSmsText, suggestCategory };
