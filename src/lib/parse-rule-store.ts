"use client";

import { nowIso } from "@/lib/date";
import { getMeta, setMeta } from "@/lib/db";
import { normalizeRule, type ParseRule } from "@/lib/parse-rule";

// 解析规则存在本机（Dexie meta），暂不参与云端同步：
// 它属于「设备上的导入习惯」，不同设备可以有不同的账单格式。

const RULES_KEY = "import:rules";
const ACTIVE_RULE_KEY = "import:activeRuleId";

export async function listRules(): Promise<ParseRule[]> {
  const raw = await getMeta(RULES_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRule)
      .filter((rule): rule is ParseRule => rule !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function saveRule(rule: ParseRule): Promise<ParseRule> {
  const rules = await listRules();
  const next: ParseRule = { ...rule, updatedAt: nowIso() };
  const index = rules.findIndex((item) => item.id === rule.id);
  if (index >= 0) rules[index] = next;
  else rules.push(next);
  await setMeta(RULES_KEY, JSON.stringify(rules));
  await setActiveRuleId(next.id);
  return next;
}

export async function deleteRule(id: string): Promise<void> {
  const rules = (await listRules()).filter((rule) => rule.id !== id);
  await setMeta(RULES_KEY, JSON.stringify(rules));
  const active = await getActiveRuleId();
  if (active === id) {
    await setActiveRuleId(rules[0]?.id ?? null);
  }
}

export async function getActiveRuleId(): Promise<string | null> {
  return getMeta(ACTIVE_RULE_KEY);
}

export async function setActiveRuleId(id: string | null): Promise<void> {
  await setMeta(ACTIVE_RULE_KEY, id ?? "");
}
