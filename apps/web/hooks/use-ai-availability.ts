"use client";

import { useEffect, useState } from "react";

/**
 * AI 是否可用（用户在「设置 › AI 服务」配置过，或服务端有环境变量兜底）。
 * 结果在会话内缓存；未知（加载中 / 请求失败）返回 null，调用方按「可用」处理，
 * 避免网络抖动时把功能误置灰。
 */
let cached: boolean | null = null;
let inflight: Promise<boolean | null> | null = null;

function load(): Promise<boolean | null> {
  if (cached !== null) return Promise.resolve(cached);
  inflight ??= fetch("/api/ai/settings", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { available?: boolean } | null) => {
      cached = typeof data?.available === "boolean" ? data.available : null;
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 编辑器挂载时预取，避免第一次打开斜杠菜单时结果还没回来（未知按「可用」显示） */
export function prefetchAiAvailability() {
  void load();
}

/** 设置页保存 / 清除 AI 配置后调用，下次读取重新请求 */
export function invalidateAiAvailability() {
  cached = null;
}

export function useAiAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(cached);
  useEffect(() => {
    let active = true;
    void load().then((value) => {
      if (active) setAvailable(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return available;
}
