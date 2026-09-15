"use client";

import { useEffect, useRef } from "react";
import { getPlatform } from "@/lib/platform/detect";
import { getNotifier } from "@/lib/platform/notifications";
import { isSuppressedByLocalDue, NOTIFIED_DUE_STORAGE_KEY } from "@/lib/tasks/notifications";
import type { DueSoonTask } from "@/lib/tasks/due-soon";

/**
 * 桌面壳（Tauri）任务提醒兜底轮询：每 5 分钟拉 /api/tasks/due-soon
 * （当前用户未来 15 分钟内到期/开始的未完成任务），按 task_id+anchor
 * 去重后走系统通知（getNotifier）。
 *
 * 背景：Web Push 在 WebView2 后台挂起时可能丢推送（multi-platform-plan
 * §3.2），本轮询是同源 HTTP 的第二条投递路径；双响防线 = tauri 平台不注册
 * SW Web Push（见 components/layout/sw-registrar.tsx）+ 本地去重键与
 * cron 投递的 delivery_id 语义天然隔离（后者只在已订阅设备上出现）。
 *
 * C05 S2 D2 双响收敛：壳内 1.1 页面本地 due 提醒（organize:notified-due 键）
 * 与本轮询并存，同一任务同一时刻（±15min 窗口）两条都报会双响——轮询发通知前
 * 查该任务的本地已通知键，命中即抑制（页面本地已报，轮询让位）。残余边界：
 * 页面已排程但尚未触发的 due 超时（键未写入）先被轮询抢报的窗口极窄
 * （两者目标时刻近乎重合且均为同一任务的到期语义），接受并记录。
 */
export function ReminderPoller() {
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (getPlatform() !== "tauri") return;

    const POLL_INTERVAL_MS = 5 * 60 * 1000;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const ensurePermission = async () => {
      const notifier = getNotifier();
      const state = await notifier.queryPermission();
      if (state === "granted" || state === "denied") return;
      await notifier.requestPermission();
    };

    const readLocalDueKeys = (): Set<string> => {
      try {
        const stored = localStorage.getItem(NOTIFIED_DUE_STORAGE_KEY);
        return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
      } catch {
        return new Set();
      }
    };

    const poll = async () => {
      const notifier = getNotifier();
      if (!notifier.isSupported() || cancelled) return;
      try {
        const response = await fetch("/api/tasks/due-soon");
        if (!response.ok) return;
        const tasks = (await response.json()) as DueSoonTask[];
        const notified = notifiedRef.current;
        const localDueKeys = readLocalDueKeys();
        const nowMs = Date.now();
        for (const task of tasks) {
          if (!task?.task_id || !task.title) continue;
          const key = `${task.task_id}:${task.anchor}`;
          if (notified.has(key)) continue;
          if (isSuppressedByLocalDue(task.task_id, nowMs, localDueKeys)) {
            // 同一任务同刻已由页面本地 due 提醒覆盖（C05 S2 D2）
            notified.add(key);
            continue;
          }
          notified.add(key);
          await notifier.notify({
            title: task.anchor === "end" ? "任务即将到期" : "任务即将开始",
            body: task.title,
            tag: key,
            // tauri plugin-notification v2 无点击回调，暂忽略；带上以向前兼容
            url: `/tasks/${task.task_id}`,
          });
        }
      } catch {
        // 网络/后端不可用静默跳过，下个周期再拉
      }
    };

    void ensurePermission().then(() => poll());
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
