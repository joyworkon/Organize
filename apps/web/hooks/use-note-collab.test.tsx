// @vitest-environment jsdom
/**
 * useNoteCollab 匿名分支（072）：提供 anonymousToken 时跳过 supabase 会话查询，
 * 连接 token = "share:<token>"，房间名不变（note:<uuid>）；无 token 走既有会话路径。
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const providerCtor = vi.fn();

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    constructor(options: Record<string, unknown>) {
      providerCtor(options);
    }
    on() {}
    isSynced = false;
    destroy() {}
  },
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
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession,
      getUser: async () => ({ data: { user: { id: "abcdef01" } } }),
    },
  }),
}));

import { useNoteCollab } from "./use-note-collab";

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

describe("useNoteCollab 匿名分支", () => {
  beforeEach(() => {
    providerCtor.mockClear();
    getSession.mockReset();
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = "ws://127.0.0.1:1420";
  });

  it("uses share: token and never queries the session when anonymousToken is provided", async () => {
    const { out, unmount } = renderHook({
      noteId: "79020000-0000-0000-0000-000000000001",
      enabled: true,
      displayName: "访客",
      anonymousToken: "tok-abc",
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(providerCtor).toHaveBeenCalledTimes(1);
    const opts = providerCtor.mock.calls[0][0];
    expect(opts.token).toBe("share:tok-abc");
    expect(opts.name).toBe("note:79020000-0000-0000-0000-000000000001");
    expect(out.current?.provider).not.toBeNull();
    unmount();
  });

  it("still resolves the session for logged-in collaborators", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-token" } } });
    renderHook({
      noteId: "79020000-0000-0000-0000-000000000001",
      enabled: true,
      displayName: "甲",
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(providerCtor.mock.calls[0][0].token).toBe("jwt-token");
  });

  it("does not connect when disabled", () => {
    const { unmount } = renderHook({
      noteId: "x",
      enabled: false,
      displayName: "访客",
      anonymousToken: "t",
    });
    expect(providerCtor).not.toHaveBeenCalled();
    unmount();
  });
});
