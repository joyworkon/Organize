"use client";

import { Node, Extension } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { useMemo } from "react";

/**
 * 公式节点（行内 + 区块），使用 KaTeX 渲染 LaTeX。
 * 点击公式可重新编辑 LaTeX 源码。
 */

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
      return latex;
    }
  }, [latex, isBlock]);

  const handleClick = () => {
    const next = window.prompt("编辑公式（LaTeX）", latex);
    if (next !== null && next !== latex) {
      updateAttributes({ latex: next });
    }
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
        rendered = node.attrs.latex as string;
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
