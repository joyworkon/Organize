"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { localizeAuthError } from "@/lib/auth/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"form" | "done" | "error">("form");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  // 邮件链接先经 /auth/callback 换取会话再跳到这里（URL 不再带 code），
  // 所以以「当前是否有会话」判断链接是否有效；直接带 code 打开时就地兑换。
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      const code = searchParams.get("code");
      if (code) await supabase.auth.exchangeCodeForSession(code).catch(() => null);
      const { data } = await supabase.auth.getSession();
      if (active) setHasSession(!!data.session);
    })();
    return () => {
      active = false;
    };
  }, [supabase, searchParams]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      // Supabase 邮件链接回跳后会话已恢复（PKCE），直接 updateUser 换密码
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setStatus("error");
        setMessage(localizeAuthError(error.message));
        return;
      }
      setStatus("done");
      setTimeout(() => router.push("/"), 1500);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "重置失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  if (hasSession === null) return null;

  // 没有恢复会话（直接访问 / 链接失效 / 已过期）
  if (!hasSession && status === "form") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <Card className="w-full max-w-[400px]">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">重置密码</CardTitle>
            <CardDescription>链接无效或已过期，请重新从登录页发送重置邮件</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => router.push("/login")}>返回登录</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">设置新密码</CardTitle>
          <CardDescription>密码至少 6 位</CardDescription>
        </CardHeader>
        <CardContent>
          {status === "done" ? (
            <p className="text-sm text-green-600 text-center py-4">
              密码已重置，正在跳转到阅读库…
            </p>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <Input
                type="password"
                placeholder="新密码"
                aria-label="新密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              {message && <p className="text-sm text-destructive">{message}</p>}
              <Button type="submit" className="w-full" disabled={loading || password.length < 6}>
                {loading ? "提交中..." : "重置密码"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
