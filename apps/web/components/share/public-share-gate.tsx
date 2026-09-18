"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";

interface PublicShareGateProps {
  token: string;
  /** 进入后是只读还是可编辑（决定按钮文案，取自 get_public_share 的元信息） */
  accessMode: "public_read" | "public_edit";
}

type Phase = "idle" | "claiming" | "blocked" | "failed";

/**
 * 「确认进入」闸门（082）。
 *
 * 为什么必须是一道**显式点击**而不是打开链接即认领：链接预览爬虫
 * （微信/Slack 的 unfurl）只 GET 不点——认领挂在读页面上会被爬虫直接烧掉，
 * 真正的收件人反而进不来。所以锁放在这里，读页面在服务端就不带内容。
 *
 * claim_id 每次挂载只生成一次并复用：双击 / 网络重试 / React StrictMode 双跑
 * 会命中 RPC 的幂等短路，返回同一会话，不吃掉第二个名额。
 */
export default function PublicShareGate({ token, accessMode }: PublicShareGateProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const claimIdRef = useRef<string | null>(null);

  const claim = useCallback(async () => {
    if (phase === "claiming") return;
    if (!claimIdRef.current) claimIdRef.current = crypto.randomUUID();
    setPhase("claiming");
    setMessage(null);

    let payload: { status?: string; error?: string } = {};
    try {
      const res = await fetch(`/api/public-share/${token}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_id: claimIdRef.current }),
      });
      payload = (await res.json().catch(() => ({}))) as typeof payload;
      if (!res.ok && !payload.status) {
        setPhase("failed");
        setMessage(payload.error || "暂时无法进入，请稍后重试");
        return;
      }
    } catch {
      setPhase("failed");
      setMessage("网络异常，请稍后重试");
      return;
    }

    switch (payload.status) {
      case "ok":
      case "not_required":
        // 凭证已在 Set-Cookie 下发，重新渲染服务端组件即可拿到内容
        router.refresh();
        return;
      case "no_quota":
        // 链接被转发给第二个人时的正常结果：名额已被先到的人占用
        setPhase("blocked");
        setMessage("这个链接的名额已被占用。如果你确实需要访问，请联系分享者重新发放。");
        return;
      case "ip_mismatch":
        setPhase("blocked");
        setMessage("当前网络不在这个链接允许的范围内。请换回原先的网络，或联系分享者。");
        return;
      default:
        setPhase("blocked");
        setMessage("链接已失效或无权访问。");
    }
  }, [phase, router, token]);

  // blocked：名额被占 / IP 不符 —— 点也没用，不给重试按钮
  // failed：网络或服务端瞬时故障 —— 保留按钮让人重试
  const blocked = phase === "blocked";

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="mb-3 text-xl font-semibold">
        {blocked ? "无法进入" : "这是一条受限的分享链接"}
      </h1>

      {!blocked && (
        <p className="mb-8 text-sm text-muted-foreground">
          分享者为这条链接设置了访问名额。确认进入后
          {accessMode === "public_edit" ? "可以参与编辑" : "可以浏览"}，名额将被占用。
        </p>
      )}

      {blocked && message && (
        <div className="mb-8 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {!blocked && (
        <>
          {phase === "failed" && message && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}
          <Button onClick={() => void claim()} disabled={phase === "claiming"}>
            {phase === "claiming" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在进入…
              </>
            ) : (
              "确认进入"
            )}
          </Button>
          {phase === "claiming" && (
            <p className="mt-4 text-xs text-muted-foreground">正在占用名额，请不要关闭页面。</p>
          )}
        </>
      )}
    </div>
  );
}
