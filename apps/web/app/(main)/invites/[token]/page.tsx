"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

interface RedeemResult {
  status?: string;
  reason?: string;
  resource_type?: string;
  resource_id?: string;
}

/**
 * 邮箱邀请兑现页（Track A，071）：邀请邮件的 redirectTo 落在这里，
 * mount 后调 redeem_share_invite —— ok 即跳到对应内容（复用既有协作链路），
 * 否则展示拒绝原因（过期 / 邮箱不符 / 已兑现 / 无效，统一不可区分时如实说「无效或已过期」）。
 * 未登录直接打开时 middleware 先引导登录；邮件链接经 /auth/callback?next 回到这里。
 */
export default function InviteRedeemPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;

    // mock 后端没有协作/邀请层（ADR 0003）：如实报错，不假成功
    if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
      setState("error");
      setMessage("当前为演示环境，不支持邀请兑现");
      return;
    }

    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("redeem_share_invite", { p_token: token });
      if (cancelled) return;

      const result = (Array.isArray(data) ? data[0] : data) as RedeemResult | null;
      if (error || !result || result.status !== "ok") {
        setState("error");
        setMessage(describeRejection(result, error?.message));
        return;
      }

      setState("ok");
      const id = result.resource_id ?? "";
      // 不留历史栈：邀请页是一次性入口
      router.replace(
        result.resource_type === "reading_item" ? `/library/${id}` : `/notes/${id}`
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-8 text-center shadow-sm">
        {state === "loading" && (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">正在兑现邀请…</p>
          </>
        )}
        {state === "ok" && (
          <>
            <p className="text-sm font-medium">邀请已兑现，正在打开内容…</p>
            <p className="text-xs text-muted-foreground">如果没有自动跳转，请刷新页面。</p>
          </>
        )}
        {state === "error" && (
          <>
            <p className="text-sm font-medium text-destructive">无法兑现邀请</p>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link
              href="/library"
              className="inline-block text-sm text-primary hover:underline"
            >
              返回首页
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function describeRejection(result: RedeemResult | null, errorMessage?: string): string {
  if (result?.reason === "email_mismatch") {
    return "当前登录账号与被邀请邮箱不一致，请用邀请发送到的邮箱登录后再打开此链接。";
  }
  if (result?.reason === "anonymous" || errorMessage === "JWT issuer is invalid") {
    return "请先登录，再打开邀请链接。";
  }
  // token 不存在 / 已过期 / 已撤销 / 已兑现 / 伪造：服务端统一 forbidden，不可区分
  if (result?.status === "forbidden") {
    return "邀请链接无效或已过期，请联系分享者重新发送。";
  }
  return errorMessage ? "邀请兑现失败，请稍后重试。" : "邀请链接无效或已过期，请联系分享者重新发送。";
}
