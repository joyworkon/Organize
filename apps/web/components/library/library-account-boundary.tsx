"use client";

// 资料库账号边界：与工作台 DashboardHub 同一守卫（先订阅 auth 事件，再读 getSession，
// 旧的首读结果不得覆盖较新的 auth 事件）。子树按 userId keyed remount——换号时五视图、
// 搜索、导入队列、统一输入框全部重建；同账号 token 刷新不 remount，输入与搜索保留。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type LibraryAccount =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; userId: string | null };

export function LibraryAccountBoundary({ children }: { children: (userId: string) => ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [account, setAccount] = useState<LibraryAccount>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let authEventSeen = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      authEventSeen = true;
      const userId = session?.user.id ?? null;
      setAccount((prev) => (prev.status === "ready" && prev.userId === userId ? prev : { status: "ready", userId }));
    });
    void Promise.resolve().then(() => supabase.auth.getSession()).then(({ data, error }) => {
      if (!active || authEventSeen) return;
      if (error) {
        setAccount({ status: "error" });
        return;
      }
      setAccount({ status: "ready", userId: data.session?.user.id ?? null });
    }).catch(() => {
      if (active && !authEventSeen) setAccount({ status: "error" });
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase, retry]);

  if (account.status === "loading") {
    return <div className="grid min-h-40 place-items-center text-sm text-muted-foreground" role="status">正在确认账户…</div>;
  }
  if (account.status === "error") {
    return (
      <div className="grid min-h-40 place-items-center gap-2 text-sm" role="alert">
        <p>暂时无法确认账户，请重试。</p>
        <Button variant="outline" onClick={() => { setAccount({ status: "loading" }); setRetry((n) => n + 1); }}>重试</Button>
      </div>
    );
  }
  if (!account.userId) {
    return (
      <div className="grid min-h-40 place-items-center gap-2 text-sm">
        <p>登录后查看你的资料库。</p>
        <Link href="/login" className="underline underline-offset-4">前往登录</Link>
      </div>
    );
  }
  return <KeyedAccount key={account.userId} userId={account.userId}>{children}</KeyedAccount>;
}

function KeyedAccount({ userId, children }: { userId: string; children: (userId: string) => ReactNode }) {
  return <>{children(userId)}</>;
}
