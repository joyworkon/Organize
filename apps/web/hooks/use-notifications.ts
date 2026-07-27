"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Task } from "@organize/shared";

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
    const notified = notifiedRef.current;

    tasks.forEach((task) => {
      if (!task.due_date || task.status === "done" || task.status === "cancelled") {
        return;
      }

      const dueDate = new Date(task.due_date);
      const fifteenMinutesBefore = new Date(dueDate.getTime() - 15 * 60 * 1000);

      const notifyKey15Min = `${task.id}-15min`;
      const notifyKeyDue = `${task.id}-due`;
      const notifyKeyToday = `${task.id}-today`;

      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfDueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
      const isToday = startOfToday.getTime() === startOfDueDate.getTime();

      if (isToday && !notified.has(notifyKeyToday)) {
        if (dueDate > now) {
          showNotification("任务到期提醒", `任务即将到期：${task.title}`);
        } else {
          showNotification("任务已过期", `任务已过期：${task.title}`);
        }
        notified.add(notifyKeyToday);
      }

      if (fifteenMinutesBefore > now && !notified.has(notifyKey15Min)) {
        const msUntil15Min = fifteenMinutesBefore.getTime() - now.getTime();
        const timeout = setTimeout(() => {
          if (!notified.has(notifyKey15Min)) {
            showNotification("任务即将到期", `任务即将到期：${task.title}（15分钟后）`);
            notified.add(notifyKey15Min);
            saveNotifiedTaskIds(notified);
          }
        }, msUntil15Min);
        timeoutsRef.current.push(timeout);
      }

      if (dueDate > now && !notified.has(notifyKeyDue)) {
        const msUntilDue = dueDate.getTime() - now.getTime();
        const timeout = setTimeout(() => {
          if (!notified.has(notifyKeyDue)) {
            showNotification("任务到期提醒", `任务已到期：${task.title}`);
            notified.add(notifyKeyDue);
            saveNotifiedTaskIds(notified);
          }
        }, msUntilDue);
        timeoutsRef.current.push(timeout);
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
