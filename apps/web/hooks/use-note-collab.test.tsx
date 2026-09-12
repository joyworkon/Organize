// @vitest-environment jsdom
/**
 * useNoteCollab（072 匿名分支 + A05 会话健壮性）：
 * - anonymousToken：跳过 supabase 会话查询，token 函数恒回 "share:<token>"，房间名 note:<uuid>
 * - 登录：token 为函数（A05），每次重握手重新取会话
 * - 鉴权失败重试与降级（A05 D1）、门控超时降级（D4）、退出账号销毁（D8）、resolved 派生
 */
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

type ProviderOptions = {
  token?: unknown;
  name?: string;
  onStatus?: (data: { status: string }) => void;
  onAuthenticationFailed?: (data: { reason: string }) => void;
};

// vi.mock 工厂被提升到文件顶部，mock 类与共享状态都须经 vi.hoisted 声明
const { instances, providerCtor, MockProvider } = vi.hoisted(() => {
  type Opts = {
    token?: unknown;
    name?: string;
    onStatus?: (data: { status: string }) => void;
    onAuthenticationFailed?: (data: { reason: string }) => void;
  };
  const instances: {
    options: Opts;
    destroyed: boolean;
    connectCount: number;
    disconnectCount: number;
    emit: (event: string) => void;
    simulateStatus: (s: string) => void;
    simulateAuthFailed: (r?: string) => void;
    simulateSynced: () => void;
    simulateAuthenticated: () => void;
  }[] = [];
  const providerCtor = vi.fn();

  class MockProvider {
    options: Opts;
    isSynced = false;
    destroyed = false;
    connectCount = 0;
    disconnectCount = 0;
    private handlers = new Map<string, (() => void)[]>();

    constructor(options: Opts) {
      this.options = options;
      providerCtor(options);
      instances.push(this);
    }
    on(event: string, fn: () => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    }
    emit(event: string) {
      for (const fn of this.handlers.get(event) ?? []) fn();
    }
    destroy() {
      this.destroyed = true;
    }
    connect() {
      this.connectCount += 1;
      return Promise.resolve();
    }
    disconnect() {
      this.disconnectCount += 1;
    }
    /** 测试辅助：模拟 WS 状态与鉴权结果 */
    simulateStatus(status: string) {
      this.options.onStatus?.({ status });
    }
    simulateAuthFailed(reason = "unauthorized") {
      this.options.onAuthenticationFailed?.({ reason });
    }
    simulateSynced() {
      this.isSynced = true;
      this.emit("synced");
    }
    simulateAuthenticated() {
      this.emit("authenticated");
    }
  }
  return { instances, providerCtor, MockProvider };
});

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: MockProvider,
}));
vi.mock("y-protocols/awareness", () => ({
  Awareness: class {
    clientID = 1;
    on() {}
    getStates() {
      return new Map();
    }
    setLocalStateField() {}
  },
}));
vi.mock("yjs", () => ({
  Doc: class {},
}));

const getSession: Mock = vi.fn();
const getUser: Mock = vi.fn();
const authStateHandlers: ((event: string, session: unknown) => void)[] = [];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession,
      getUser,
      onAuthStateChange(handler: (event: string, session: unknown) => void) {
        authStateHandlers.push(handler);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  }),
}));

import { useNoteCollab } from "./use-note-collab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderHook(options: Parameters<typeof useNoteCollab>[0]) {
  const out: { current: ReturnType<typeof useNoteCollab> | null } = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const Harness = (props: Parameters<typeof useNoteCollab>[0]) => {
    out.current = useNoteCollab(props);
    return null;
  };
  act(() => {
    root.render(createElement(Harness, options));
  });
  return {
    out,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const NOTE_ID = "79020000-0000-0000-0000-000000000001";

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useNoteCollab 会话与 token（072 + A05）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    providerCtor.mockClear();
    instances.length = 0;
    authStateHandlers.length = 0;
    getSession.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "abcdef01" } } });
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-seed" } } });
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = "ws://127.0.0.1:1420";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("匿名：token 为恒回 share:<token> 的函数，且不查会话", async () => {
    const { out, unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "访客",
      anonymousToken: "tok-abc",
    });
    await settle();
    expect(getSession).not.toHaveBeenCalled();
    expect(providerCtor).toHaveBeenCalledTimes(1);
    const opts = providerCtor.mock.calls[0][0];
    expect(typeof opts.token).toBe("function");
    expect(opts.token()).toBe("share:tok-abc");
    expect(opts.name).toBe(`note:${NOTE_ID}`);
    expect(out.current?.provider).not.toBeNull();
    expect(out.current?.status).toBe("connecting");
    expect(out.current?.resolved).toBe(false);
    unmount();
  });

  it("登录：token 为函数，每次调用现取会话 token", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-1" } } });
    renderHook({ noteId: NOTE_ID, enabled: true, displayName: "甲" });
    await settle();
    expect(getSession).toHaveBeenCalledTimes(1);
    const opts = providerCtor.mock.calls[0][0];
    expect(typeof opts.token).toBe("function");
    await expect(opts.token()).resolves.toBe("jwt-1");
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-2" } } });
    await expect(opts.token()).resolves.toBe("jwt-2");
  });

  it("禁用时不连接", () => {
    const { out, unmount } = renderHook({
      noteId: "x",
      enabled: false,
      displayName: "访客",
      anonymousToken: "t",
    });
    expect(providerCtor).not.toHaveBeenCalled();
    expect(out.current?.status).toBe("off");
    expect(out.current?.resolved).toBe(true);
    unmount();
  });

  it("状态机：WS connected → connected，首次 synced → resolved", async () => {
    const { out, unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "甲",
    });
    await settle();
    const p = instances[0];
    act(() => p.simulateStatus("connected"));
    expect(out.current?.status).toBe("connected");
    expect(out.current?.connected).toBe(true);
    expect(out.current?.resolved).toBe(false);
    act(() => p.simulateSynced());
    expect(out.current?.synced).toBe(true);
    expect(out.current?.resolved).toBe(true);
    // 断线重连中不丢 resolved（内容已在本地 ydoc，可继续离线编辑）
    act(() => p.simulateStatus("connecting"));
    expect(out.current?.status).toBe("connecting");
    expect(out.current?.resolved).toBe(true);
    unmount();
  });

  it("鉴权失败：已同步会话被撤权时 3 次退避重握手（disconnect+connect，provider 不重建），耗尽后降级 error", async () => {
    const { out, unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "甲",
    });
    await settle();
    const p = instances[0];
    // 先完成首次同步：门控解除（撤权重试的退避全程允许跑完，见 A05 设计 §3.3）
    act(() => p.simulateStatus("connected"));
    act(() => p.simulateSynced());
    act(() => p.simulateAuthFailed());
    expect(out.current?.status).toBe("connected");
    await act(async () => vi.advanceTimersByTimeAsync(2_100));
    expect(p.disconnectCount).toBe(1);
    expect(p.connectCount).toBe(1);
    expect(instances.length).toBe(1);
    act(() => p.simulateAuthFailed());
    await act(async () => vi.advanceTimersByTimeAsync(5_100));
    expect(p.connectCount).toBe(2);
    act(() => p.simulateAuthFailed());
    await act(async () => vi.advanceTimersByTimeAsync(10_100));
    expect(p.connectCount).toBe(3);
    // 第 4 次失败：无更多退避 → 降级
    act(() => p.simulateAuthFailed());
    expect(p.destroyed).toBe(true);
    expect(out.current?.provider).toBeNull();
    expect(out.current?.status).toBe("error");
    expect(out.current?.resolved).toBe(true);
    unmount();
  });

  it("鉴权失败发生在门控窗口内：门控超时先到 → 整体降级（不无限重试）", async () => {
    const { out, unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "甲",
    });
    await settle();
    const p = instances[0];
    act(() => p.simulateAuthFailed());
    await act(async () => vi.advanceTimersByTimeAsync(2_100));
    expect(p.connectCount).toBe(1);
    act(() => p.simulateAuthFailed());
    // 门控 10s 在第二次退避（5s）后、第三次（10s）前触发
    await act(async () => vi.advanceTimersByTimeAsync(9_000));
    expect(p.destroyed).toBe(true);
    expect(out.current?.status).toBe("error");
    expect(p.connectCount).toBe(2);
    unmount();
  });

  it("门控超时：GATE_TIMEOUT 内未 synced → 销毁降级 error", async () => {
    const { out, unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "甲",
    });
    await settle();
    const p = instances[0];
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(out.current?.status).toBe("connecting");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(p.destroyed).toBe(true);
    expect(out.current?.status).toBe("error");
    expect(out.current?.resolved).toBe(true);
    unmount();
  });

  it("退出登录：旧 provider 立即销毁并以新会话重建", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-1" } } });
    const { out, unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "甲",
    });
    await settle();
    expect(instances.length).toBe(1);
    const first = instances[0];
    act(() => {
      for (const handler of authStateHandlers) handler("SIGNED_OUT", null);
    });
    expect(first.destroyed).toBe(true);
    // 代际变化触发重建（新 provider、新 token 函数求值）
    await settle();
    expect(instances.length).toBe(2);
    expect(out.current?.provider).toBe(instances[1]);
    unmount();
  });

  it("服务端主动 close（撤权重验路径）：主动退避重握手，synced 后预算复位", async () => {
    const { out, unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "甲",
    });
    await settle();
    const p = instances[0];
    act(() => p.simulateStatus("connected"));
    act(() => p.simulateSynced());
    // 已同步会话被服务端关闭文档连接（A05-3 撤权 close）：文档级 CLOSE 不关
    // socket、provider 不会自动重新鉴权——hook 必须主动重握手
    act(() => p.emit("close"));
    await act(async () => vi.advanceTimersByTimeAsync(1_100));
    expect(p.disconnectCount).toBe(1);
    expect(p.connectCount).toBe(1);
    expect(out.current?.status).not.toBe("error"); // 重握手不算降级
    // 重连成功（再次 synced）后退避预算复位
    act(() => p.simulateSynced());
    act(() => p.emit("close"));
    await act(async () => vi.advanceTimersByTimeAsync(1_100));
    expect(p.connectCount).toBe(2);
    unmount();
  });

  it("同页切换账号（SIGNED_IN 且 user id 变化）：重建会话", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-1" } } });
    const { unmount } = renderHook({
      noteId: NOTE_ID,
      enabled: true,
      displayName: "甲",
    });
    await settle();
    expect(instances.length).toBe(1);
    act(() => {
      for (const handler of authStateHandlers) handler("SIGNED_IN", { user: { id: "u-1" } });
    });
    expect(instances.length).toBe(1); // 同 id 不重建
    act(() => {
      for (const handler of authStateHandlers) handler("SIGNED_IN", { user: { id: "u-2" } });
    });
    expect(instances[0].destroyed).toBe(true);
    await settle();
    expect(instances.length).toBe(2);
    unmount();
  });
});
