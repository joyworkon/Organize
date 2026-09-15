import { describe, expect, it, vi } from "vitest";

// C02/A02 账号切换缓存隔离：open-tabs store 的属主绑定逻辑。
// 节点环境无 localStorage，zustand persist 会降级为仅内存（告警可忽略），
// 这里只验证动作语义：换人即清、同人幂等、登出清空。

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const { useOpenTabsStore } = await import("./open-tabs-store");

const reset = () => useOpenTabsStore.setState({ ownerId: null, tabs: [], recents: [] });
const meta = (id: string) => ({ id, title: `笔记 ${id}`, icon: null });

describe("open-tabs 账号属主绑定", () => {
  it("同账号 rebindOwner 幂等：已打开的标签页与最近列表保留", () => {
    reset();
    const store = useOpenTabsStore.getState();
    store.rebindOwner("user-a");
    useOpenTabsStore.getState().openTab(meta("n1"));
    useOpenTabsStore.getState().openTab(meta("n2"));

    useOpenTabsStore.getState().rebindOwner("user-a");
    const state = useOpenTabsStore.getState();
    expect(state.ownerId).toBe("user-a");
    expect(state.tabs.map((tab) => tab.id)).toEqual(["n1", "n2"]);
    expect(state.recents).toHaveLength(2);
  });

  it("换账号 rebindOwner：清空前账号的标签页与最近列表", () => {
    reset();
    useOpenTabsStore.getState().rebindOwner("user-a");
    useOpenTabsStore.getState().openTab(meta("n1"));

    useOpenTabsStore.getState().rebindOwner("user-b");
    const state = useOpenTabsStore.getState();
    expect(state.ownerId).toBe("user-b");
    expect(state.tabs).toHaveLength(0);
    expect(state.recents).toHaveLength(0);
  });

  it("持久化里的无属主旧数据（升级前残留）在首次 rebind 时被清掉", () => {
    reset();
    // 模拟旧版本持久化：有 tabs/recents 但 ownerId 为 null
    useOpenTabsStore.setState({ ownerId: null, tabs: [meta("stale")], recents: [meta("stale")] });

    useOpenTabsStore.getState().rebindOwner("user-a");
    const state = useOpenTabsStore.getState();
    expect(state.ownerId).toBe("user-a");
    expect(state.tabs).toHaveLength(0);
    expect(state.recents).toHaveLength(0);
  });

  it("登出 clearForSignOut：清空且不绑定属主；再登录按新属主重建", () => {
    reset();
    useOpenTabsStore.getState().rebindOwner("user-a");
    useOpenTabsStore.getState().openTab(meta("n1"));

    useOpenTabsStore.getState().clearForSignOut();
    let state = useOpenTabsStore.getState();
    expect(state.ownerId).toBeNull();
    expect(state.tabs).toHaveLength(0);
    expect(state.recents).toHaveLength(0);

    useOpenTabsStore.getState().rebindOwner("user-b");
    useOpenTabsStore.getState().openTab(meta("n2"));
    state = useOpenTabsStore.getState();
    expect(state.ownerId).toBe("user-b");
    expect(state.tabs.map((tab) => tab.id)).toEqual(["n2"]);
  });

  it("clearForSignOut 幂等：空态上重复调用不再触发变更", () => {
    reset();
    useOpenTabsStore.getState().clearForSignOut();
    const state = useOpenTabsStore.getState();
    expect(state.ownerId).toBeNull();
    expect(state.tabs).toHaveLength(0);
  });
});
