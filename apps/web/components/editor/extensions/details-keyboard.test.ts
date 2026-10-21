// @vitest-environment jsdom
/**
 * 折叠块键盘与可访问性：
 * - summary 内 Mod+Enter 切换持久化 open（与三角按钮点击同路径），光标留在 summary；
 * - 光标不在 summary 时 Mod+Enter 不拦截（details 保持不变）；
 * - 收起状态 summary 末尾 Enter 在折叠块后新建同级段落（不钻进隐藏内容）；
 * - 空 summary Backspace 解包折叠块，内容不丢；
 * - 三角按钮 aria-expanded 跟随真实展开状态（NodeView 内同步）。
 * 注：jsdom 无布局（offsetParent 恒 null），上游把内容一律视为「不可见」，
 * 因此「展开状态 Enter 进内容区」的分支无法在单测覆盖，由 e2e 兜底。
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { DetailsKeyboard, OrganizeDetails } from "./details-keyboard";

const EXTENSIONS = [
  StarterKit,
  OrganizeDetails.configure({ persist: true }),
  DetailsContent,
  DetailsSummary,
  DetailsKeyboard,
];

const openDetailsDoc = {
  type: "doc",
  content: [
    {
      type: "details",
      attrs: { open: true },
      content: [
        { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
        { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "内容" }] }] },
      ],
    },
  ],
};

/** doc[0]=details(1) > summary(2..4) ；summary 文本从 pos 2 开始 */
const SUMMARY_CARET = 3;
const SUMMARY_END = 4;

// 与 prosemirror-keymap 相同的平台判定，保证在任意 UA 的测试环境里命中 Mod-
const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);

function press(editor: Editor, key: string, { mod = false }: { mod?: boolean } = {}) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...(mod ? (isMac ? { metaKey: true } : { ctrlKey: true }) : {}),
    })
  );
}

function caret(editor: Editor, pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

describe("DetailsKeyboard：Mod+Enter", () => {
  it("summary 内切换持久化 open 且光标留在 summary", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: openDetailsDoc });
    caret(editor, SUMMARY_CARET);
    press(editor, "Enter", { mod: true });
    expect(editor.state.doc.firstChild?.attrs.open).toBe(false);
    expect(editor.state.selection.$anchor.parent.type.name).toBe("detailsSummary");
    press(editor, "Enter", { mod: true });
    expect(editor.state.doc.firstChild?.attrs.open).toBe(true);
    expect(editor.state.selection.$anchor.parent.type.name).toBe("detailsSummary");
    editor.destroy();
  });

  it("光标不在 summary 时不拦截：details 不变（其余键位行为交还既有绑定，如 hardBreak）", () => {
    const editor = new Editor({
      extensions: EXTENSIONS,
      content: {
        type: "doc",
        content: [
          ...(openDetailsDoc.content as object[]),
          { type: "paragraph", content: [{ type: "text", text: "外部段落" }] },
        ],
      },
    });
    caret(editor, editor.state.doc.content.size - 1); // 外部段落末尾
    press(editor, "Enter", { mod: true });
    // 折叠块自身保持展开、内容不变；外部段落里发生什么（hardBreak 等既有键位）不在本扩展职责内
    expect(editor.state.doc.firstChild?.type.name).toBe("details");
    expect(editor.state.doc.firstChild?.attrs.open).toBe(true);
    expect(editor.state.doc.firstChild?.firstChild?.textContent).toBe("标题");
    editor.destroy();
  });
});

describe("折叠块回车/退格边界（上游行为锁定）", () => {
  it("收起状态 summary 末尾 Enter：在折叠块后新建同级段落，内容保留", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: openDetailsDoc });
    // jsdom 无布局，上游一律按「收起」处理：Enter 落在折叠块之后
    caret(editor, SUMMARY_END);
    press(editor, "Enter");
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.firstChild?.type.name).toBe("details");
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.selection.$anchor.depth).toBe(1); // 光标在新段落，没钻进隐藏内容
    expect(doc.firstChild?.firstChild?.textContent).toBe("标题");
    editor.destroy();
  });

  it("空 summary Backspace 解包，折叠内容不丢", () => {
    const editor = new Editor({
      extensions: EXTENSIONS,
      content: {
        type: "doc",
        content: [
          {
            type: "details",
            attrs: { open: true },
            content: [
              { type: "detailsSummary" },
              { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] },
            ],
          },
        ],
      },
    });
    caret(editor, 2); // 空 summary 起点parentOffset=0
    press(editor, "Backspace");
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe("paragraph");
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(1).textContent).toBe("正文");
    editor.destroy();
  });
});

describe("三角按钮 aria（NodeView 内同步）", () => {
  it("初始化后立即收起不会被延迟展开覆盖", async () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: openDetailsDoc });
    caret(editor, SUMMARY_CARET);
    press(editor, "Enter", { mod: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dom = editor.view.nodeDOM(0) as HTMLElement;
    expect(editor.state.doc.firstChild?.attrs.open).toBe(false);
    expect(dom.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    expect(dom.querySelector("[data-type='detailsContent']")?.hasAttribute("hidden")).toBe(true);
    editor.destroy();
  });

  it("aria-expanded 跟随展开状态", async () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: openDetailsDoc });
    const toggle = () =>
      (editor.view.nodeDOM(0) as HTMLElement).querySelector<HTMLButtonElement>(":scope > button");
    // 初始 is-open class 走 setTimeout，等一拍
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle()?.getAttribute("aria-label")).toBe("展开或折叠");
    caret(editor, SUMMARY_CARET);
    press(editor, "Enter", { mod: true });
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    // 点三角按钮切回展开（与 Mod+Enter 同路径）
    toggle()?.click();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    editor.destroy();
  });
});
