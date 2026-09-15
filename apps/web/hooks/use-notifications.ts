"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Task } from "@organize/shared";
import {
  MAX_TIMEOUT_MS,
  buildDueReminders,
  buildOverdueSummary,
  effectiveDueDate,
  filterShadowedReminders,
  NOTIFIED_DUE_STORAGE_KEY,
  pruneNotifiedKeys,
} from "@/lib/tasks/notifications";
import { reminderFireAt } from "@/lib/tasks/reminders";
import { getNotifier } from "@/lib/platform/notifications";
import { getPlatform } from "@/lib/platform/detect";
import { createClient } from "@/lib/supabase/client";

/** 每日逾期摘要：记录上次推送的日期串，同一天只推一次 */
const OVERDUE_SUMMARY_DATE_KEY = "organize:overdue-summary-date";

type NotificationPermissionState = NotificationPermission | "unsupported";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function getNotifiedTaskIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(NOTIFIED_DUE_STORAGE_KEY);
    if (stored) {
      const ids = JSON.parse(stored) as string[];
      return new Set(ids);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function saveNotifiedTaskIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NOTIFIED_DUE_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

/**
 * C05 S2 D1 双响收敛：拉取任务的已配置提醒行（task_reminders，用户会话 RLS），
 * 计算各自将触发的绝对时刻（reminderFireAt，锚点+offset）。
 * 任何失败（网络/权限/mock 空表）返回空集 = 不抑制，行为与收敛前一致——
 * 抑制只增强，不引入新的失败面。
 */
async function fetchConfiguredFireAts(tasks: Task[]): Promise<Map<string, number[]>> {
  const byTask = new Map<string, number[]>();
  if (tasks.length === 0) return byTask;
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("task_reminders")
      .select("task_id, anchor, offset_minutes")
      .in("task_id", tasks.map((task) => task.id));
    if (error || !data) return byTask;
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    for (const row of data as Array<{ task_id: string; anchor: string; offset_minutes: number }>) {
      const task = taskById.get(row.task_id);
      if (!task) continue;
      const fireAt = reminderFireAt(task, {
        anchor: row.anchor === "end" ? "end" : "start",
        offset_minutes: row.offset_minutes,
      });
      if (!fireAt) continue;
      const list = byTask.get(row.task_id) ?? [];
      list.push(fireAt.getTime());
      byTask.set(row.task_id, list);
    }
  } catch {
    // 降级为不抑制
  }
  return byTask;
}

/** Web 推送订阅（Push API）只在浏览器平台有意义；桌面/移动壳用各自的原生通知 */
async function subscribeWebPush(): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return true;
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  return response.ok;
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermissionState>("default");
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const notifiedRef = useRef<Set<string>>(getNotifiedTaskIds());
  const notifier = getNotifier();

  useEffect(() => {
    if (!notifier.isSupported()) {
      setPermission("unsupported");
      return;
    }
    let active = true;
    void notifier.queryPermission().then((state) => {
      if (active) setPermission(state);
    });
    return () => {
      active = false;
    };
  }, [notifier]);

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    timeoutsRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!notifier.isSupported()) {
      return false;
    }

    try {
      const granted = await notifier.requestPermission();
      setPermission(granted ? "granted" : "denied");
      if (!granted) return false;

      // Web 平台顺带建立 Push 订阅（服务端推送用）；原生平台不需要
      if (getPlatform() === "web") {
        return await subscribeWebPush();
      }
      return true;
    } catch {
      return false;
    }
  }, [notifier]);

  const showNotification = useCallback(
    (title: string, body: string, url?: string) => {
      void notifier.notify({ title, body, tag: `due-${title}`, url });
    },
    [notifier]
  );

  const scheduleDueDateReminders = useCallback(
    (tasks: Task[]) => {
      if (!notifier.isSupported() || permission !== "granted") {
        return;
      }

      clearAllTimeouts();
      // C05 S2 D1：排程前拉已配置提醒行（失败降级空集=不抑制），异步部分不阻塞调用方
      void (async () => {
        const configuredFireAts = await fetchConfiguredFireAts(tasks);
        const now = new Date();

        // 清理失效幂等 key：已删除/已完成/已改期任务的旧 key 全部移除，
        // 否则改期后新日期永远不再提醒，且 localStorage 无限增长
        const current = new Map<string, number>();
        tasks.forEach((task) => {
          if (task.status === "done" || task.status === "cancelled") return;
          const due = effectiveDueDate(task);
          if (due) current.set(task.id, due.getTime());
        });
        notifiedRef.current = pruneNotifiedKeys(notifiedRef.current, current);
        const notified = notifiedRef.current;

        tasks.forEach((task) => {
          // 双响收敛：±DEDUP_WINDOW_MS 内有已配置提醒行的 due 变体跳过本地报
          for (const reminder of filterShadowedReminders(buildDueReminders(task, now), configuredFireAts)) {
            if (notified.has(reminder.key)) continue;
            const delay = reminder.fireAt - now.getTime();
            if (delay <= 0) {
              showNotification(reminder.title, reminder.body, `/tasks/${reminder.taskId}`);
              notified.add(reminder.key);
            } else if (delay <= MAX_TIMEOUT_MS) {
              const timeout = setTimeout(() => {
                if (!notified.has(reminder.key)) {
                  showNotification(reminder.title, reminder.body, `/tasks/${reminder.taskId}`);
                  notified.add(reminder.key);
                  saveNotifiedTaskIds(notified);
                }
              }, delay);
              timeoutsRef.current.push(timeout);
            }
            // delay > MAX_TIMEOUT_MS（≈24.8 天）时 setTimeout 会溢出立即触发，
            // 直接跳过排程；任务临近后本函数随任务列表刷新再次执行即可正常排程
          }
        });

        saveNotifiedTaskIds(notified);
      })();
    },
    [clearAllTimeouts, notifier, permission, showNotification]
  );

  /** 每日一次的逾期摘要通知（同一天只推一次；无逾期或当天到期不推） */
  const notifyOverdueSummary = useCallback((tasks: Task[]) => {
    if (!notifier.isSupported() || permission !== "granted") return;
    const todayKey = new Date().toDateString();
    try {
      if (localStorage.getItem(OVERDUE_SUMMARY_DATE_KEY) === todayKey) return;
    } catch {
      // localStorage 不可用时照常推送，最多多推一次
    }
    const summary = buildOverdueSummary(tasks, new Date());
    if (!summary) return;
    showNotification(summary.title, summary.body, "/tasks");
    try {
      localStorage.setItem(OVERDUE_SUMMARY_DATE_KEY, todayKey);
    } catch {
      // ignore
    }
  }, [notifier, permission, showNotification]);

  return {
    permission,
    requestPermission,
    scheduleDueDateReminders,
    notifyOverdueSummary,
  };
}
