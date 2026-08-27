"use client";

import { Node, Extension } from "@tiptap/core";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { useMemo } from "react";

/**
 * 公式节点（行内 + 区块），使用 KaTeX 渲染 LaTeX。
 * 点击公式可重新编辑 LaTeX 源码。
 */

/** KaTeX 之外的兜底路径必须按纯文本转义：latex 是用户可控输入，直接注入 innerHTML 会形成 XSS 面 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function MathNodeView({ node, updateAttributes, extension }: NodeViewProps) {
  const isBlock = extension.name === "mathBlock";
  const latex = (node.attrs.latex as string) || "";

  const html = useMemo(() => {
    try {
      return katex.renderToString(latex || "\\;", {
        throwOnError: false,
        displayMode: isBlock,
      });
    } catch {
      return `<span class="text-destructive">${escapeHtml(latex)}</span>`;
    }
  }, [latex, isBlock]);

  const handleClick = () => {
    void showPrompt({ title: "编辑公式（LaTeX）", defaultValue: latex }).then((next) => {
      if (next !== null && next !== latex) {
        updateAttributes({ latex: next });
      }
    });
  };

  return (
    <NodeViewWrapper
      as={isBlock ? "div" : "span"}
      className={isBlock ? "math-block" : "math-inline"}
      contentEditable={false}
      onClick={handleClick}
      title="点击编辑公式"
    >
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </NodeViewWrapper>
  );
}

function createMathNode(name: string, isBlock: boolean) {
  return Node.create({
    name,
    group: isBlock ? "block" : "inline",
    inline: !isBlock,
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        latex: {
          default: "",
          parseHTML: (el) => (el as HTMLElement).getAttribute("data-latex") || "",
        },
      };
    },

    parseHTML() {
      return [{ tag: `${isBlock ? "div" : "span"}[data-${isBlock ? "math-block" : "math-inline"}]` }];
    },

    renderHTML({ HTMLAttributes, node }) {
      let rendered: string;
      try {
        rendered = katex.renderToString((node.attrs.latex as string) || "\\;", {
          throwOnError: false,
          displayMode: isBlock,
        });
      } catch {
        rendered = `<span class="text-destructive">${escapeHtml(node.attrs.latex as string)}</span>`;
      }
      const wrapper = document.createElement(isBlock ? "div" : "span");
      wrapper.setAttribute(`data-${isBlock ? "math-block" : "math-inline"}`, "");
      wrapper.setAttribute("data-latex", (node.attrs.latex as string) || "");
      wrapper.innerHTML = rendered;
      return wrapper;
    },

    addNodeView() {
      return ReactNodeViewRenderer(MathNodeView);
    },
  });
}

export const InlineMath = createMathNode("inlineMath", false);
export const MathBlock = createMathNode("mathBlock", true);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      insertInlineMath: (latex: string) => ReturnType;
      insertMathBlock: (latex: string) => ReturnType;
    };
  }
}

export const MathCommands = Extension.create({
  name: "mathCommands",

  addCommands() {
    return {
      insertInlineMath:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: "inlineMath", attrs: { latex } }),
      insertMathBlock:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: "mathBlock", attrs: { latex } }),
    };
  },
});
