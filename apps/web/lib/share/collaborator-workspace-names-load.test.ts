import { describe, expect, it } from "vitest";

import {
  COLLABORATOR_WORKSPACE_NAMES_LOAD_ERROR_MESSAGE,
  nextCollaboratorWorkspaceNamesAfterLoad,
} from "./collaborator-workspace-names-load";

const acl = (workspace_id: string, access_role = "viewer") => ({ workspace_id, access_role });

describe("nextCollaboratorWorkspaceNamesAfterLoad", () => {
  it("成功有名：按 grant 顺序组装 wsName，无错误", () => {
    const result = nextCollaboratorWorkspaceNamesAfterLoad({
      grantRows: [acl("ws-1", "editor"), acl("ws-2", "viewer")],
      nameById: new Map([
        ["ws-1", "产品组"],
        ["ws-2", "设计组"],
      ]),
      error: null,
    });
    expect(result.rows).toEqual([
      { wsName: "产品组", role: "editor" },
      { wsName: "设计组", role: "viewer" },
    ]);
    expect(result.loadError).toBeNull();
  });

  it("成功但个别 id 查不到名字：该行回退「协作空间」，不算失败", () => {
    const result = nextCollaboratorWorkspaceNamesAfterLoad({
      grantRows: [acl("ws-1"), acl("ws-missing")],
      nameById: new Map([["ws-1", "产品组"]]),
      error: null,
    });
    expect(result.rows).toEqual([
      { wsName: "产品组", role: "viewer" },
      { wsName: "协作空间", role: "viewer" },
    ]);
    expect(result.loadError).toBeNull();
  });

  it("名称查询失败：仍组装 rows（缺名回退「协作空间」）+ 错误文案，不清空授权列表", () => {
    const result = nextCollaboratorWorkspaceNamesAfterLoad({
      grantRows: [acl("ws-1", "editor"), acl("ws-2")],
      nameById: new Map(),
      error: { message: "permission denied for table workspaces" },
    });
    expect(result.rows).toEqual([
      { wsName: "协作空间", role: "editor" },
      { wsName: "协作空间", role: "viewer" },
    ]);
    expect(result.loadError).toBe(COLLABORATOR_WORKSPACE_NAMES_LOAD_ERROR_MESSAGE);
  });

  it("名称查询失败且 grant 为空：空 rows + 错误文案", () => {
    const result = nextCollaboratorWorkspaceNamesAfterLoad({
      grantRows: [],
      nameById: new Map(),
      error: new Error("fetch failed"),
    });
    expect(result.rows).toEqual([]);
    expect(result.loadError).toBe(COLLABORATOR_WORKSPACE_NAMES_LOAD_ERROR_MESSAGE);
  });

  it("nameById 也接受 Record 形状（与 Map 等价）", () => {
    const result = nextCollaboratorWorkspaceNamesAfterLoad({
      grantRows: [acl("ws-1")],
      nameById: { "ws-1": "产品组" },
      error: null,
    });
    expect(result.rows).toEqual([{ wsName: "产品组", role: "viewer" }]);
    expect(result.loadError).toBeNull();
  });
});
