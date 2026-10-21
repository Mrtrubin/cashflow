"use client";

import {
  ChartColumn,
  House,
  List,
  type LucideIcon,
  Plus,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", label: "首页", icon: House },
  { href: "/records", label: "明细", icon: List },
  { href: "/stats", label: "统计", icon: ChartColumn },
  { href: "/settings", label: "设置", icon: Settings },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="grid h-16 grid-cols-5 items-center">
        {tabs.slice(0, 2).map((tab) => (
          <TabItem
            key={tab.href}
            href={tab.href}
            label={tab.label}
            icon={tab.icon}
            active={isActive(tab.href)}
          />
        ))}
        <li className="flex justify-center">
          <Link
            href="/records/new"
            aria-label="记账"
            className="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
          >
            <Plus className="size-6" aria-hidden="true" />
          </Link>
        </li>
        {tabs.slice(2).map((tab) => (
          <TabItem
            key={tab.href}
            href={tab.href}
            label={tab.label}
            icon={tab.icon}
            active={isActive(tab.href)}
          />
        ))}
      </ul>
    </nav>
  );
}

function TabItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-col items-center gap-1 text-xs",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
        {label}
      </Link>
    </li>
  );
}
