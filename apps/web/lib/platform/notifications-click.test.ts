// @vitest-environment jsdom
/**
 * web 平台通知点击导航（C05 S1）：构造式通知点击后派发应用内导航事件
 * （components/platform/notification-navigate 监听转 SPA 路由）。
 * 外部/非法路径在派发前被 sanitize 剔除；未授权时不构造通知。
 * node 环境下 web notifier 全降级（见 notifications.test.ts），点击路径需 jsdom。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_NAVIGATE_EVENT,
  getNotifier,
  resetNotifierCache,
} from "./notifications";
import { sanitizeNavigatePath } from "./navigate";

class NotificationStub {
  static permission: NotificationPermission = "granted";
  onclick: (() => void) | null = null;
  constructor(
    public title: string,
    public options?: NotificationOptions
  ) {}
  close() {}
}

const notified: NotificationStub[] = [];

function installNotifier(permission: NotificationPermission = "granted") {
  NotificationStub.permission = permission;
  notified.length = 0;
  vi.stubGlobal(
    "Notification",
    class extends NotificationStub {
      constructor(title: string, options?: NotificationOptions) {
        super(title, options);
        notified.push(this);
      }
    }
  );
}

describe("web notifier 点击导航", () => {
  beforeEach(() => {
    resetNotifierCache();
    vi.unstubAllGlobals();
  });

  it("点击派发应用内导航事件，detail 为目标路径", async () => {
    installNotifier();
    const dispatched: unknown[] = [];
    window.addEventListener(NOTIFICATION_NAVIGATE_EVENT, (event) => {
      dispatched.push((event as CustomEvent).detail);
    });
    await getNotifier("web").notify({
      title: "任务到期提醒",
      body: "任务已到期：写周报",
      tag: "due-x",
      url: "/tasks/task-1",
    });
    expect(notified).toHaveLength(1);
    notified[0].onclick!();
    expect(dispatched).toEqual(["/tasks/task-1"]);
  });

  it("外部 URL 被拒绝：点击不派发导航事件", async () => {
    installNotifier();
    const dispatched: unknown[] = [];
    window.addEventListener(NOTIFICATION_NAVIGATE_EVENT, (event) => {
      dispatched.push((event as CustomEvent).detail);
    });
    await getNotifier("web").notify({
      title: "任务到期提醒",
      url: "https://evil.example/tasks",
    });
    expect(sanitizeNavigatePath("https://evil.example/tasks")).toBeNull();
    notified[0].onclick!();
    expect(dispatched).toEqual([]);
  });

  it("未带 url 的通知点击只聚焦不派发", async () => {
    installNotifier();
    const dispatched: unknown[] = [];
    window.addEventListener(NOTIFICATION_NAVIGATE_EVENT, (event) => {
      dispatched.push((event as CustomEvent).detail);
    });
    await getNotifier("web").notify({ title: "你有 2 个任务已逾期" });
    notified[0].onclick!();
    expect(dispatched).toEqual([]);
  });

  it("未授权时不构造通知", async () => {
    installNotifier("default");
    await getNotifier("web").notify({ title: "任务到期提醒", url: "/tasks/task-1" });
    expect(notified).toHaveLength(0);
  });
});
