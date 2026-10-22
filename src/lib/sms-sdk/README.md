# 短信解析 SDK

位于 `src/lib/sms-sdk`，零运行时依赖（ZIP 解压使用浏览器/Node 自带的 `DecompressionStream`）。

## 能力

- 读取小米手机「短信」本地备份：
  - 直接传 `.zip`（内含水印/`descript.xml` + `短信(com.android.mms).bak`）
  - 传解压后的 `.bak`
  - 传 `ANDROID BACKUP` 字节
- 解析 MIUI 的 protobuf 短信记录（`apps/com.android.mms/miui_bak/_tmp_bak`）
- 从短信里识别账单：
  - 工商银行借记卡收支短信
  - 中国银行信用卡首次交易
  - 杭州银行西湖卡收支
  - 微信支付付款/退款通知
  - 通用银行规则（尾号/卡号 + 收支动作 + 金额）
- 自动跳过验证码、营销、信用卡账单提醒、手机话费月账单等非交易短信
- 输出统一的 `SmsBillTransaction`，包含日期、时间、金额（分）、银行、卡号后四位、
  商户、建议分类、建议账户、备注和标签

## 用法

```ts
import {
  extractBillTransactions,
  parseSmsBackup,
} from "@/lib/sms-sdk";

const backup = await parseSmsBackup(file); // File / Blob / ArrayBuffer / Uint8Array

console.log(backup.meta.messageCount, backup.messages.length);

const result = extractBillTransactions(backup.messages, {
  includeSent: false,     // 默认只看收件箱
  includeWallets: true,   // 是否包含微信支付短信
  since: "2026-01-01",    // 可选
});

for (const txn of result.transactions) {
  console.log(txn.date, txn.time, txn.kind, txn.amountCents, txn.note);
}
```

`extractBillTransactions` 返回：

```ts
{
  transactions: SmsBillTransaction[];
  total: number;      // 参与识别的短信数
  matched: number;    // 识别出的账单数
  skipped: number;    // 未识别数
  byBank: Record<string, number>;
}
```

## 自定义规则

`SmsBillRule` 是一个 `match(context)` 函数。可以只用自己的规则替换内置规则：

```ts
const rules = [
  {
    id: "my-bank",
    match: ({ body, receivedAt }) => {
      const m = body.match(/尾号(\d{4}).*?支出([\d.]+)元/);
      if (!m) return null;
      return {
        kind: "expense",
        amountCents: Math.round(Number(m[2]) * 100),
        date: "2026-01-01", // 也可以用 extractDate 辅助
        time: "12:30",
        bank: "我的银行",
        cardTail: m[1],
      };
    },
  },
];

extractBillTransactions(messages, { rules });
```

## 隐私与边界

- 解析全部在调用方本地完成，不发网络请求。
- 不支持加密的 Android Backup；会在错误里提示。
- 不支持旧版 SQLite `.db` 备份；只支持 MIUI 的 `_tmp_bak` protobuf。
- 银行短信格式会变。识别不到时，优先在 `bill-rules.ts` 里补一条结构明确的规则，
  不要把正则散落到页面组件里。
