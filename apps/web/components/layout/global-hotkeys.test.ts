import { describe, expect, it } from "vitest";
import { GOTO_HINT, GOTO_ROUTES, PAGE_SHORTCUTS, SHORTCUTS } from "./global-hotkeys";

// C01 键位清单一致性校验：帮助弹窗（SHORTCUTS）、gotoMode 提示串（GOTO_HINT）
// 与运行时 g 序列注册表（GOTO_ROUTES）必须三方一致。
// 历史缺陷：g m（速记）注册后帮助清单与提示串漏同步——此测试防复发。
// 约定：新增全局键位只改 GOTO_ROUTES / SHORTCUTS 手工段；页面级键位
// （n、/、v、m、x 等）由各页面自行注册，PAGE_SHORTCUTS 仅做格式卫生检查。

describe("全局键位清单一致性", () => {
  it("帮助清单的每个 g 条目都有对应的运行时注册（无死文档）", () => {
    const registered = new Set(GOTO_ROUTES.map((r) => r.sequence.join(" ")));
    const helpGoto = SHORTCUTS.filter((s) => s.keys.startsWith("g "));
    expect(helpGoto.length).toBeGreaterThan(0);
    for (const s of helpGoto) {
      expect(registered, `帮助清单里的 ${s.keys} 未注册`).toContain(s.keys);
    }
  });

  it("运行时注册的每个 g 序列都进了帮助清单（无遗漏，g m 缺陷回归）", () => {
    const helpKeys = new Set(SHORTCUTS.map((s) => s.keys));
    for (const r of GOTO_ROUTES) {
      const key = r.sequence.join(" ");
      expect(helpKeys, `注册的 ${key}（跳转到${r.label}）未出现在帮助清单`).toContain(key);
    }
  });

  it("帮助清单 g 条目与注册表逐条对齐（键位与文案一致、顺序一致）", () => {
    const helpGoto = SHORTCUTS.filter((s) => s.keys.startsWith("g "));
    expect(helpGoto).toEqual(
      GOTO_ROUTES.map(({ sequence, label }) => ({ keys: sequence.join(" "), desc: `跳转到${label}` }))
    );
  });

  it("gotoMode 提示串包含全部注册键位且按注册顺序排列", () => {
    const expected = `按 g 后，按 ${GOTO_ROUTES.map((r) => r.sequence[1]).join("/")} 跳转...`;
    expect(GOTO_HINT).toBe(expected);
  });

  it("手工条目（⌘K/⌘N/?/Esc）在帮助清单中存在", () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(keys).toContain("⌘K");
    expect(keys).toContain("⌘N");
    expect(keys).toContain("?");
    expect(keys).toContain("Esc");
  });

  it("注册表与帮助清单均无重复键位", () => {
    const seqKeys = GOTO_ROUTES.map((r) => r.sequence.join(" "));
    expect(new Set(seqKeys).size).toBe(seqKeys.length);
    const helpKeys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(helpKeys).size).toBe(helpKeys.length);
  });

  it("注册表路径均为站内路径且 label 非空", () => {
    for (const r of GOTO_ROUTES) {
      expect(r.path.startsWith("/"), `${r.path} 应为站内路径`).toBe(true);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.sequence[0]).toBe("g");
      expect(r.sequence[1].length).toBe(1);
    }
  });

  it("页面级清单每组非空且组内键位不重复", () => {
    expect(PAGE_SHORTCUTS.length).toBeGreaterThan(0);
    for (const group of PAGE_SHORTCUTS) {
      expect(group.items.length).toBeGreaterThan(0);
      const keys = group.items.map((s) => s.keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
