import { Extension, findParentNode, mergeAttributes } from "@tiptap/core";
import Details from "@tiptap/extension-details";

/**
 * 折叠块（Details）键盘与可访问性增强（不改上游 schema/序列化合同）：
 *
 * - OrganizeDetails：在上游 Details 之上
 *   1) open 默认 true（新建折叠块直接进入可编辑状态；旧文档无 open 属性的折叠块展开显示）；
 *   2) 自持 NodeView（复刻上游 2.27 的 DOM：div[data-type=details] > button + contentDOM），
 *      三角按钮带 aria-label / aria-expanded，并在每次展开/收起后同步；
 *      ignoreMutation 只放行内容洞（contentDOM）里的变更——按钮与容器自身的 class/aria
 *      变化不交给 ProseMirror 重解析（上游实现会把按钮属性变化当作文档变更，外部写
 *      aria 会触发「重解析 → 重建 NodeView → 再写」的死循环）。
 *   其余行为（点击切换、persist 写回 open、只读时仅视觉切换、光标保持）与上游一致。
 *
 * - DetailsKeyboard：summary 内 Mod+Enter 切换展开/收起。通过驱动三角按钮点击实现，
 *   与鼠标点击完全同路径。priority 高于 StarterKit（hardBreak 同样绑定 Mod-Enter）：
 *   仅在 summary 内消费该键，其余场景返回 false 放行。
 *   上游 DetailsSummary 自带的 Enter（收起时在块后新建同级段落）/Backspace（空
 *   summary 解包不吞内容）/ArrowRight/Down（越过隐藏内容）行为保持不变。
 */

export const DETAILS_TOGGLE_LABEL = "展开或折叠";

export const OrganizeDetails = Details.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      open: {
        default: true,
        parseHTML: (el: HTMLElement) => el.hasAttribute("open"),
        renderHTML: (attributes: { open?: boolean }) => (attributes.open ? { open: "" } : {}),
      },
    };
  },

  addNodeView() {
    return ({ editor, getPos, node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-type": this.name });
      Object.entries(attributes).forEach(([key, value]) => dom.setAttribute(key, String(value)));

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.contentEditable = "false";
      toggle.setAttribute("aria-label", DETAILS_TOGGLE_LABEL);
      toggle.setAttribute("aria-expanded", "false");
      dom.append(toggle);

      const content = document.createElement("div");
      dom.append(content);

      const syncAria = () => {
        const expanded = dom.classList.contains(this.options.openClassName) ? "true" : "false";
        if (toggle.getAttribute("aria-expanded") !== expanded) toggle.setAttribute("aria-expanded", expanded);
      };

      const toggleDetailsContent = (setToValue?: boolean) => {
        const openClassName = this.options.openClassName;
        if (setToValue !== undefined) {
          if (setToValue) {
            if (dom.classList.contains(openClassName)) return;
            dom.classList.add(openClassName);
          } else {
            if (!dom.classList.contains(openClassName)) return;
            dom.classList.remove(openClassName);
          }
        } else {
          dom.classList.toggle(openClassName);
        }
        syncAria();
        const event = new Event("toggleDetailsContent");
        const detailsContent = content.querySelector(':scope > div[data-type="detailsContent"]');
        detailsContent?.dispatchEvent(event);
      };

      // 初始展开：contentDOM 此刻尚未填充，延后一拍再加 class（幂等，不用上游的无参 toggle）
      let currentOpen = Boolean(node.attrs.open);
      const initialToggle = setTimeout(() => toggleDetailsContent(currentOpen));

      toggle.addEventListener("click", () => {
        toggleDetailsContent();
        if (!this.options.persist) {
          editor.commands.focus(undefined, { scrollIntoView: false });
          return;
        }
        if (editor.isEditable && typeof getPos === "function") {
          const { from, to } = editor.state.selection;
          editor
            .chain()
            .command(({ tr }) => {
              const pos = getPos();
              if (typeof pos !== "number") return false;
              const currentNode = tr.doc.nodeAt(pos);
              if (currentNode?.type !== this.type) return false;
              tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, open: !currentNode.attrs.open });
              return true;
            })
            .setTextSelection({ from, to })
            .focus(undefined, { scrollIntoView: false })
            .run();
        }
      });

      return {
        dom,
        contentDOM: content,
        stopEvent: (event) => event.target === toggle,
        ignoreMutation(mutation) {
          if (mutation.type === "selection") return false;
          // 只放行内容洞（含其自身 childList）里的变更；按钮/容器的 class、aria 由本 NodeView 管理
          return !(mutation.target === content || content.contains(mutation.target));
        },
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) return false;
          if (updatedNode.attrs.open !== undefined) {
            currentOpen = Boolean(updatedNode.attrs.open);
            toggleDetailsContent(currentOpen);
          }
          return true;
        },
        destroy: () => clearTimeout(initialToggle),
      };
    };
  },
});

export const DetailsKeyboard = Extension.create({
  name: "detailsKeyboard",
  // 高于 StarterKit 各扩展（默认 100），让本扩展的 keymap 先于 hardBreak 的 Mod-Enter
  priority: 200,

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => {
        const { state } = this.editor;
        const { selection, schema } = state;
        const summaryType = schema.nodes.detailsSummary;
        const detailsType = schema.nodes.details;
        if (!summaryType || !detailsType) return false;
        if (!selection.empty || selection.$anchor.parent.type !== summaryType) return false;
        const details = findParentNode((candidate) => candidate.type === detailsType)(selection);
        if (!details) return false;
        const dom = this.editor.view.nodeDOM(details.pos);
        const toggle = dom instanceof HTMLElement ? dom.querySelector<HTMLButtonElement>(":scope > button") : null;
        if (!toggle) return false;
        toggle.click();
        return true;
      },
    };
  },
});
