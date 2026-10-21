import type { ReactNode } from "react";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { SyncRunner } from "@/components/sync-runner";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SyncRunner />
      <div className="flex flex-1 flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <MobileTabBar />
    </>
  );
}
