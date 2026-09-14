import { detectPlatform, type HostPlatform } from "./detect";
import { sanitizeNavigatePath } from "./navigate";

/**
 * 统一系统通知抽象：应用代码只面向 PlatformNotifier 编程，
 * web（Notification API）/ tauri（plugin-notification）/ capacitor
 * （local-notifications）各自实现，按当前平台分发。
 *
 * 原生桥接包通过动态 import 加载——web 构建不执行原生代码路径，
 * 对应平台运行时才拉取桥接模块。
 */

/** 通知点击跳转的窗口事件名（components/platform/notification-navigate 监听） */
export const NOTIFICATION_NAVIGATE_EVENT = "organize:navigate";

export interface SystemNotificationRequest {
  title: string;
  body?: string;
  /** 去重标签：同 tag 的通知相互替换（web 平台语义；原生端尽力映射） */
  tag?: string;
  /**
   * 点击通知后的应用内跳转目标（应用内相对路径）。
   * web 平台：经 sanitizeNavigatePath 校验后派发 NOTIFICATION_NAVIGATE_EVENT；
   * 仅页面上下文存活时有效（构造式通知的固有限制，页面已关时由 SW push 路径兜底）。
   * tauri plugin-notification v2 无点击回调 API，忽略。
   */
  url?: string;
}

export interface PlatformNotifier {
  /** 当前平台是否支持系统通知 */
  isSupported(): boolean;
  /** 查询当前权限状态（不触发授权弹窗） */
  queryPermission(): Promise<"granted" | "denied" | "default">;
  /** 请求通知权限，返回是否已授权 */
  requestPermission(): Promise<boolean>;
  /** 发送一条系统通知（未授权/不支持时静默跳过） */
  notify(request: SystemNotificationRequest): Promise<void>;
}

// ---------- web ----------

function createWebNotifier(): PlatformNotifier {
  const supported = () =>
    typeof window !== "undefined" && "Notification" in window;

  return {
    isSupported: supported,
    queryPermission: async () => {
      if (!supported()) return "denied";
      return Notification.permission;
    },
    requestPermission: async () => {
      if (!supported()) return false;
      try {
        return (await Notification.requestPermission()) === "granted";
      } catch {
        return false;
      }
    },
    notify: async ({ title, body, tag, url }) => {
      if (!supported() || Notification.permission !== "granted") return;
      try {
        const targetPath = sanitizeNavigatePath(url);
        const notification = new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
          // 应用内跳转走窗口事件通道（SPA 路由，不整页刷新）；
          // 非法/外部路径已在 sanitize 时剔除
          if (targetPath) {
            window.dispatchEvent(new CustomEvent(NOTIFICATION_NAVIGATE_EVENT, { detail: targetPath }));
          }
        };
      } catch {
        // 某些环境（如 iOS Safari 非 PWA）构造 Notification 会抛错，静默降级
      }
    },
  };
}

// ---------- tauri ----------

function createTauriNotifier(): PlatformNotifier {
  return {
    isSupported: () => true,
    queryPermission: async () => {
      try {
        const plugin = await import("@tauri-apps/plugin-notification");
        return (await plugin.isPermissionGranted()) ? "granted" : "default";
      } catch {
        return "denied";
      }
    },
    requestPermission: async () => {
      try {
        const plugin = await import("@tauri-apps/plugin-notification");
        if (await plugin.isPermissionGranted()) return true;
        const permission = await plugin.requestPermission();
        return permission === "granted";
      } catch {
        return false;
      }
    },
    notify: async ({ title, body }) => {
      try {
        const plugin = await import("@tauri-apps/plugin-notification");
        if (!(await plugin.isPermissionGranted())) return;
        plugin.sendNotification({ title, body });
      } catch {
        // 桥接不可用时静默跳过
      }
    },
  };
}

// ---------- capacitor ----------

function createCapacitorNotifier(): PlatformNotifier {
  return {
    isSupported: () => true,
    queryPermission: async () => {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const current = await LocalNotifications.checkPermissions();
        if (current.display === "granted") return "granted";
        if (current.display === "denied") return "denied";
        return "default";
      } catch {
        return "denied";
      }
    },
    requestPermission: async () => {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const current = await LocalNotifications.checkPermissions();
        if (current.display === "granted") return true;
        const requested = await LocalNotifications.requestPermissions();
        return requested.display === "granted";
      } catch {
        return false;
      }
    },
    notify: async ({ title, body, tag }) => {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const permission = await LocalNotifications.checkPermissions();
        if (permission.display !== "granted") return;
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Math.abs(hashString(tag ?? title) % 2147483647),
              title,
              body: body ?? "",
            },
          ],
        });
      } catch {
        // 桥接不可用时静默跳过
      }
    },
  };
}

/** 稳定字符串 hash（通知 id 用，同源 tag 覆盖旧通知） */
function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

// ---------- 分发 ----------

const factories: Record<HostPlatform, () => PlatformNotifier> = {
  web: createWebNotifier,
  tauri: createTauriNotifier,
  capacitor: createCapacitorNotifier,
};

const instances = new Map<HostPlatform, PlatformNotifier>();

/** 取当前平台的通知适配器（带缓存；测试可用 env 覆盖平台） */
export function getNotifier(platform?: HostPlatform): PlatformNotifier {
  const target = platform ?? detectPlatform();
  let notifier = instances.get(target);
  if (!notifier) {
    notifier = factories[target]();
    instances.set(target, notifier);
  }
  return notifier;
}

/** 测试用：清空适配器缓存 */
export function resetNotifierCache(): void {
  instances.clear();
}
