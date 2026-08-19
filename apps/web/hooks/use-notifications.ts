"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Task } from "@organize/shared";
import { MAX_TIMEOUT_MS, buildDueReminders, effectiveDueDate, pruneNotifiedKeys } from "@/lib/tasks/notifications";

const NOTIFIED_STORAGE_KEY = "organize:notified-due";

type NotificationPermissionState = NotificationPermission | "unsupported";

function getNotifiedTaskIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(NOTIFIED_STORAGE_KEY);
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
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermissionState>("default");
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const notifiedRef = useRef<Set<string>>(getNotifiedTaskIds());

  useEffect(() => {
    if (isNotificationSupported()) {
      setPermission(Notification.permission);
    } else {
      setPermission("unsupported");
    }
  }, []);

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
    if (!isNotificationSupported()) {
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === "granted";
    } catch {
      return false;
    }
  }, []);

  const showNotification = useCallback((title: string, body: string) => {
    if (!isNotificationSupported() || Notification.permission !== "granted") {
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: `due-${title}`,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // ignore
    }
  }, []);

  const scheduleDueDateReminders = useCallback((tasks: Task[]) => {
    if (!isNotificationSupported() || Notification.permission !== "granted") {
      return;
    }

    clearAllTimeouts();

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
      for (const reminder of buildDueReminders(task, now)) {
        if (notified.has(reminder.key)) continue;
        const delay = reminder.fireAt - now.getTime();
        if (delay <= 0) {
          showNotification(reminder.title, reminder.body);
          notified.add(reminder.key);
        } else if (delay <= MAX_TIMEOUT_MS) {
          const timeout = setTimeout(() => {
            if (!notified.has(reminder.key)) {
              showNotification(reminder.title, reminder.body);
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
  }, [clearAllTimeouts, showNotification]);

  return {
    permission,
    requestPermission,
    scheduleDueDateReminders,
  };
}
