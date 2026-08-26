import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNotifier, resetNotifierCache } from "./notifications";

// 原生桥接包在 node 测试环境下不可真实调用，用 mock 锁定成功/失败两条路径
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    schedule: vi.fn(),
  },
}));

import * as tauriPlugin from "@tauri-apps/plugin-notification";
import { LocalNotifications } from "@capacitor/local-notifications";

const tauriMock = vi.mocked(tauriPlugin);
const capacitorMock = vi.mocked(LocalNotifications);

describe("getNotifier 分发", () => {
  beforeEach(() => {
    resetNotifierCache();
  });

  it("按平台返回对应适配器，且同平台返回缓存单例", () => {
    expect(getNotifier("web")).toBe(getNotifier("web"));
    expect(getNotifier("tauri")).toBe(getNotifier("tauri"));
    expect(getNotifier("capacitor")).toBe(getNotifier("capacitor"));
    expect(getNotifier("web")).not.toBe(getNotifier("tauri"));
  });
});

describe("web 适配器", () => {
  beforeEach(() => {
    resetNotifierCache();
  });

  it("node 环境（无 window）：不支持，全部降级", async () => {
    const notifier = getNotifier("web");
    expect(notifier.isSupported()).toBe(false);
    await expect(notifier.queryPermission()).resolves.toBe("denied");
    await expect(notifier.requestPermission()).resolves.toBe(false);
    // notify 静默跳过不抛错
    await expect(notifier.notify({ title: "t" })).resolves.toBeUndefined();
  });
});

describe("tauri 适配器", () => {
  beforeEach(() => {
    resetNotifierCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("已授权：queryPermission 返回 granted，notify 直接发送", async () => {
    tauriMock.isPermissionGranted.mockResolvedValue(true);
    const notifier = getNotifier("tauri");

    await expect(notifier.queryPermission()).resolves.toBe("granted");
    await notifier.notify({ title: "任务到期", body: "写周报" });
    expect(tauriMock.sendNotification).toHaveBeenCalledWith({ title: "任务到期", body: "写周报" });
  });

  it("未授权：requestPermission 走系统授权流程", async () => {
    tauriMock.isPermissionGranted.mockResolvedValue(false);
    tauriMock.requestPermission.mockResolvedValue("granted");
    const notifier = getNotifier("tauri");

    await expect(notifier.queryPermission()).resolves.toBe("default");
    await expect(notifier.requestPermission()).resolves.toBe(true);
    expect(tauriMock.requestPermission).toHaveBeenCalled();
  });

  it("拒绝授权：requestPermission 返回 false", async () => {
    tauriMock.isPermissionGranted.mockResolvedValue(false);
    tauriMock.requestPermission.mockResolvedValue("denied");
    const notifier = getNotifier("tauri");

    await expect(notifier.requestPermission()).resolves.toBe(false);
  });

  it("未授权时 notify 不发送", async () => {
    tauriMock.isPermissionGranted.mockResolvedValue(false);
    const notifier = getNotifier("tauri");

    await notifier.notify({ title: "t" });
    expect(tauriMock.sendNotification).not.toHaveBeenCalled();
  });

  it("桥接异常：降级为 denied / false / 静默", async () => {
    tauriMock.isPermissionGranted.mockRejectedValue(new Error("ipc down"));
    tauriMock.requestPermission.mockRejectedValue(new Error("ipc down"));
    const notifier = getNotifier("tauri");

    await expect(notifier.queryPermission()).resolves.toBe("denied");
    await expect(notifier.requestPermission()).resolves.toBe(false);
    await expect(notifier.notify({ title: "t" })).resolves.toBeUndefined();
  });
});

describe("capacitor 适配器", () => {
  beforeEach(() => {
    resetNotifierCache();
    vi.clearAllMocks();
  });

  it("已授权：queryPermission 返回 granted，notify 经 schedule 发送", async () => {
    capacitorMock.checkPermissions.mockResolvedValue({ display: "granted" } as never);
    capacitorMock.schedule.mockResolvedValue({ notifications: [] } as never);
    const notifier = getNotifier("capacitor");

    await expect(notifier.queryPermission()).resolves.toBe("granted");
    await notifier.notify({ title: "任务到期", body: "写周报", tag: "due-1" });
    expect(capacitorMock.schedule).toHaveBeenCalledTimes(1);
    const payload = capacitorMock.schedule.mock.calls[0][0];
    expect(payload.notifications[0].title).toBe("任务到期");
    expect(payload.notifications[0].body).toBe("写周报");
    // 同 tag 产生稳定 id（覆盖旧通知语义）
    await notifier.notify({ title: "任务到期", body: "写周报", tag: "due-1" });
    const second = capacitorMock.schedule.mock.calls[1][0];
    expect(second.notifications[0].id).toBe(payload.notifications[0].id);
  });

  it("prompt 状态：requestPermission 发起请求并按结果返回", async () => {
    capacitorMock.checkPermissions.mockResolvedValue({ display: "prompt" } as never);
    capacitorMock.requestPermissions.mockResolvedValue({ display: "granted" } as never);
    const notifier = getNotifier("capacitor");

    await expect(notifier.queryPermission()).resolves.toBe("default");
    await expect(notifier.requestPermission()).resolves.toBe(true);
  });

  it("拒绝授权：requestPermission 返回 false，notify 不发送", async () => {
    capacitorMock.checkPermissions.mockResolvedValue({ display: "denied" } as never);
    const notifier = getNotifier("capacitor");

    await expect(notifier.queryPermission()).resolves.toBe("denied");
    await notifier.notify({ title: "t" });
    expect(capacitorMock.schedule).not.toHaveBeenCalled();
  });

  it("桥接异常：降级为 denied / false / 静默", async () => {
    capacitorMock.checkPermissions.mockRejectedValue(new Error("unimplemented"));
    capacitorMock.requestPermissions.mockRejectedValue(new Error("unimplemented"));
    const notifier = getNotifier("capacitor");

    await expect(notifier.queryPermission()).resolves.toBe("denied");
    await expect(notifier.requestPermission()).resolves.toBe(false);
    await expect(notifier.notify({ title: "t" })).resolves.toBeUndefined();
  });
});
