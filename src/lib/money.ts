// 金额工具：一律以「分」（整数）存储与计算，避免浮点误差

export const MAX_AMOUNT_CENTS = 999_999_999; // 9,999,999.99 元

/** 把用户输入（可能带 ¥、元、千分位、全角数字）解析为分；非法返回 null */
export function parseAmountToCents(input: string): number | null {
  const normalized = normalizeFullWidth(input).trim();
  if (!normalized) return null;
  const stripped = normalized.replace(/[¥￥元,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(stripped)) return null;
  const [intPart, decPart = ""] = stripped.split(".");
  const cents = Number(intPart) * 100 + Number(`${decPart}00`.slice(0, 2));
  if (cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/** 全角数字与常见全角符号转半角 */
export function normalizeFullWidth(input: string): string {
  let result = "";
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += char;
    }
  }
  return result.replace(/　/g, " ");
}

/** 分 → "3,560.50" 形式 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  const intText = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = `${intText}.${String(fen).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/** 金额键盘表达式求值（+ − × ÷，从左到右），返回分；输入非法返回 null */
export function evalExpressionCents(expression: string): number | null {
  const tokens = expression.match(/(\d+(\.\d{1,2})?|[+\-×÷])/g);
  if (!tokens || tokens.length === 0) return null;
  let acc = parseAmountToCents(tokens[0]);
  if (acc === null) return null;
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const operand = parseAmountToCents(tokens[i + 1] ?? "");
    if (!operand || operand === null) return null;
    switch (op) {
      case "+":
        acc += operand;
        break;
      case "-":
        acc -= operand;
        break;
      case "×":
        acc = Math.round((acc / 100) * (operand / 100) * 100);
        break;
      case "÷": {
        if (operand === 0) return null;
        // 保留两位小数
        acc = Math.round((acc / operand) * 100);
        break;
      }
      default:
        return null;
    }
    if (acc > MAX_AMOUNT_CENTS) return null;
  }
  if (acc <= 0 || acc > MAX_AMOUNT_CENTS) return null;
  return acc;
}
