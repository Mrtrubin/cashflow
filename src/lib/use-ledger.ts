"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/db";
import { listAccounts, listCategories, listTransactions } from "@/lib/repo";
import type { Account, Category, Transaction } from "@/lib/types";

export interface Ledger {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}

/** 加载本机账本数据（本机版直接整表读入，1 万条内性能可接受） */
export function useLedger(): Ledger | null {
  const [ledger, setLedger] = useState<Ledger | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await getDb(); // 确保播种完成
      const [accounts, categories, transactions] = await Promise.all([
        listAccounts(),
        listCategories(),
        listTransactions(),
      ]);
      if (!cancelled) setLedger({ accounts, categories, transactions });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return ledger;
}
