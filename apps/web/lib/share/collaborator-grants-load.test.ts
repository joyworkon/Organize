import { describe, expect, it } from "vitest";

import {
  COLLABORATOR_GRANTS_LOAD_ERROR_MESSAGE,
  nextCollaboratorGrantsAfterLoad,
  type CollaboratorGrantRow,
} from "./collaborator-grants-load";

const grant = (wsName: string, role = "viewer"): CollaboratorGrantRow => ({ wsName, role });

describe("nextCollaboratorGrantsAfterLoad", () => {
  it("成功有数据：原样保持顺序返回（新数组），无错误", () => {
    const data = [grant("产品组", "editor"), grant("协作空间")];
    const result = nextCollaboratorGrantsAfterLoad({ previous: [], data, error: null });
    expect(result.rows).toEqual(data);
    expect(result.rows).not.toBe(data);
    expect(result.loadError).toBeNull();
  });

  it("成功且 data null / 空数组：空 rows + 无错误（真·空态，才可显示「这篇内容通过协作空间与你共享」）", () => {
    expect(nextCollaboratorGrantsAfterLoad({ previous: [], data: null, error: null })).toEqual({
      rows: [],
      loadError: null,
    });
    expect(
      nextCollaboratorGrantsAfterLoad({ previous: [grant("产品组", "editor")], data: [], error: null })
    ).toEqual({ rows: [], loadError: null });
  });

  it("失败且有 previous：原样保留（同引用）+ 错误文案，不把失败伪装成空授权", () => {
    const previous = [grant("产品组", "editor")];
    const result = nextCollaboratorGrantsAfterLoad({
      previous,
      data: null,
      error: { message: "permission denied for table resource_acl" },
    });
    expect(result.rows).toBe(previous);
    expect(result.loadError).toBe(COLLABORATOR_GRANTS_LOAD_ERROR_MESSAGE);
  });

  it("失败且 previous 为空（首次加载即失败）：空 rows + 错误文案", () => {
    const result = nextCollaboratorGrantsAfterLoad({
      previous: [],
      data: null,
      error: new Error("fetch failed"),
    });
    expect(result.rows).toEqual([]);
    expect(result.loadError).toBe(COLLABORATOR_GRANTS_LOAD_ERROR_MESSAGE);
  });

  it("失败时 error 为 true 布尔（组件流水线 failed 标志）同样走失败分支", () => {
    const previous = [grant("产品组", "editor")];
    const result = nextCollaboratorGrantsAfterLoad({ previous, data: null, error: true });
    expect(result.rows).toBe(previous);
    expect(result.loadError).toBe(COLLABORATOR_GRANTS_LOAD_ERROR_MESSAGE);
  });
});
