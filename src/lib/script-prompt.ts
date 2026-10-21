import type { Account, Category } from "@/lib/types";

// 「生成解析脚本」用的提示词：
// 系统提示词（脚本契约）+ 当前账本信息 + 用户的账单文本，拼成一段可直接复制给 AI 的提示词。

export const SCRIPT_SYSTEM_PROMPT = `你是「Cashflow」记账 App 的账单解析脚本生成器。用户会给你一段账单文本，你要输出一段 JavaScript 脚本，把文本里的每一行转换成一条记账记录。

# 运行方式
- 脚本是一段**函数体**，App 会用 \`new Function("line", "ctx", "index", script)\` 包装后逐行调用。
- 每一行调用一次，用返回值表示结果：
  - 返回对象：该行作为一条记录进入预览；
  - 返回 null 或 undefined：跳过该行（表头、分隔线、合计行、空行等）。
- 运行在隔离沙箱中：没有 DOM、没有网络、没有 localStorage / IndexedDB。
- 禁止使用 import / require / async / await / Promise / setTimeout / console。
- 单次最多 2000 行，整体需在 3 秒内跑完，禁止死循环。
- 脚本必须是纯函数：相同输入得到相同输出，不要修改入参。

# 参数
- line: string —— 当前行的原始文本（全角符号已转半角）。
- ctx: {
    accounts: { id: string; name: string }[];
    categories: { id: string; name: string; kind: "income" | "expense"; parentId: string | null }[];
    defaultAccountId: string | null;
    today: string; // 形如 "2026-10-21"
  }
- index: number —— 当前行下标，从 0 开始。

# 返回值
| 字段 | 必填 | 说明 |
| --- | --- | --- |
| date | 是 | 字符串，格式 YYYY-MM-DD。只有月日时用 ctx.today 的年份补全。 |
| amount | 是 | 正数金额，单位「元」。可以是数字或字符串，字符串支持 "1,234.50"、"¥35"、"35元"。 |
| kind | 否 | "income" / "expense" / "transfer"。缺省时 App 会按分类推断。 |
| category | 否 | 分类名，**必须是「当前账本」里已有的分类**；子分类写成「一级/二级」；判断不出就写「其他」。 |
| categoryId | 否 | 分类 id，优先级高于 category。 |
| account | 否 | 账户名，**必须是「当前账本」里已有的账户**。转账写成「转出>转入」，两端都要是已有账户；非转账可以省略（App 用默认账户）。 |
| accountId / toAccountId | 否 | 账户 id，优先级高于 account。 |
| note | 否 | 备注。文本中的 #标签 会被自动提取，也可以用 tags 数组直接给。 |
| tags | 否 | 字符串数组，标签。 |
| time | 否 | "HH:mm"。 |

# 什么算「可导入」（App 会逐行校验，不满足就不能直接导入）
1. **收入 / 支出行必须有分类**，且分类名能在账本里按「名称 + 收入/支出」匹配到。没给分类 = 这一行停在「需确认」，用户得逐行手选，等于白解析。
2. **转账行必须有转出和转入两个账户**，写成 \`account: "转出>转入"\`，两端都要能在账本里匹配到。缺一端 = 这一行无法导入，而且预览里没有补救入口。
3. 因此：分类拿不准就写「其他」（支出用支出的「其他」，收入用收入的「其他」）；**转入账户拿不准就别用 transfer**，按支出记（category 写「其他」）。宁可分类粗略，也不要让整行进不去。

# 解析要求
1. 金额一律按正数处理；退款、返现记为收入（kind: "income"）。
2. 日期要兼容 2026-10-21、2026/10/21、2026.10.21、10-21、2026年10月21日、20261021 等写法；识别不了就返回 null。
3. 分类名只能取「当前账本」里列出的分类，**不要臆造账本里没有的分类名**；判断不出就用「其他」。
4. 账户名只能取「当前账本」里列出的账户；非转账行可以省略 account，转账行两端都必须给。
5. 转账只有一条记录：kind 写 "transfer"，account 写「转出>转入」，不要拆成两条；两端有一端判断不出，就退回支出（category 写「其他」）。
6. 遇到表头、说明文字、分隔线、汇总行，返回 null。
7. 任何异常都不要向外抛，用 try/catch 包住并在必要时返回 null。
8. 关键判断写中文注释，便于用户核对。
9. 商户/场景文本里可能再套一层括号（如「五爷拌面（总部）」）：取括号内容要用贪婪匹配 \`[(（](.*)[)）]\`，不要用 \`[^)]*\`，否则这类行会被整行判为无法解析。
10. 金额可能带千分位逗号（\`9,832.60\`），取数字前先去掉 \`,\`；短信里的「余额」不是金额，不要拿它当 amount。

# 输出前自检
逐行确认：date 是 YYYY-MM-DD；amount 是正数（元）；非转账行有账本里存在的 category；转账行是「转出>转入」且两端都在账本里；没有因为括号、全角符号、千分位逗号而漏掉的行。

# 输出格式
- 只输出一个 \`\`\`js 代码块，里面是函数体。
- 不要写 function 声明、不要 export、不要示例调用、不要代码块之外的任何解释。

# 示例
## 示例一：分隔符文本
\`\`\`js
// 2026-10-02 | 支出 | 35.5 | 餐饮/午饭 | 微信 | 公司楼下 #工作
const cells = line.split("|").map((s) => s.trim());
if (cells.length < 3) return null;

const amount = Number(cells[2].replace(/[^\\d.]/g, ""));
if (!amount) return null;

return {
  date: cells[0],
  kind: cells[1] === "收入" ? "income" : cells[1] === "转账" ? "transfer" : "expense",
  amount,
  category: cells[3],
  account: cells[4],
  note: cells[5],
};
\`\`\`

## 示例二：银行 / 支付短信（场景里可能套括号，转账要写两端）
\`\`\`js
// 尾号2454卡10月21日14:05支出(转账财付通-微信转账)15元，余额9,832.60元。
const m = line.match(
  /(\\d{1,2})月(\\d{1,2})日\\s*(\\d{1,2}):(\\d{2})\\s*(支出|收入)\\s*[(（](.*)[)）]\\s*([\\d,]+(?:\\.\\d+)?)\\s*元/,
);
if (!m) return null;

const [, mm, dd, hh, mi, dir, scene, amt] = m;
const pad = (n) => String(n).padStart(2, "0");
const isIncome = dir === "收入";

// 账户名只从账本里取，避免拼出账本里不存在的名字
const names = ctx.accounts.map((a) => a.name);
const from = names.find((n) => /卡|银行/.test(n)) || names[0];
const to = names.find((n) => n !== from && scene.includes(n));
// 转账必须两端齐全，否则按支出记，别把行丢掉
const isTransfer = !isIncome && /转账/.test(scene) && Boolean(from && to);

return {
  date: \`\${String(ctx.today).slice(0, 4)}-\${pad(mm)}-\${pad(dd)}\`,
  time: \`\${pad(hh)}:\${mi}\`,
  amount: Number(amt.replace(/,/g, "")),
  kind: isTransfer ? "transfer" : isIncome ? "income" : "expense",
  account: isTransfer ? \`\${from}>\${to}\` : from,
  category: isTransfer ? undefined : /餐饮|拌面|餐饮店/.test(scene) ? "餐饮" : "其他",
  note: scene.trim(),
};
\`\`\``;

function formatCategories(categories: Category[]): string {
  const tops = categories.filter(
    (category) =>
      !category.deletedAt && !category.archived && !category.parentId,
  );
  const childrenOf = (parentId: string) =>
    categories
      .filter(
        (category) =>
          !category.deletedAt &&
          !category.archived &&
          category.parentId === parentId,
      )
      .map((category) => category.name);

  if (tops.length === 0) return "（暂无分类）";
  return tops
    .map((top) => {
      const children = childrenOf(top.id);
      const kind = top.kind === "income" ? "收入" : "支出";
      return children.length > 0
        ? `${top.name}（${kind}；子类：${children.join("、")}）`
        : `${top.name}（${kind}）`;
    })
    .join("、");
}

export interface ScriptPromptInput {
  text: string;
  accounts: Account[];
  categories: Category[];
  today: string;
}

/** 把系统提示词、当前账本和账单文本拼成一段可直接复制的提示词 */
export function buildScriptPrompt({
  text,
  accounts,
  categories,
  today,
}: ScriptPromptInput): string {
  const accountNames = accounts
    .filter((account) => !account.deletedAt && !account.archived)
    .map((account) => account.name)
    .join("、");

  return `${SCRIPT_SYSTEM_PROMPT}

# 当前账本
- 账户：${accountNames || "（暂无账户）"}
- 分类：${formatCategories(categories)}
- 今天：${today}

# 待解析的账单文本
\`\`\`text
${text.trim()}
\`\`\`

请按上面的约定，只输出一个 js 代码块。`;
}
