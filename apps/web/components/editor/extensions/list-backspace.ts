import { Extension } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";

/**
 * 块首退格修正：当光标在一个「带标记的结构块」最前面按退格时，把该块转成普通正文段落，
 * 而不是沿用 TipTap 默认行为（把内容合并到上一行、且删不掉序号 / 圆点 / 方块 / ▶ 等标记）。
 *
 * 覆盖的块类型：
 *  - 项目符号列表 / 编号列表（listItem）、待办列表（taskItem）→ liftListItem 抬回正文
 *  - 引用（blockquote）、标注（callout）、代码块（codeBlock）→ clearNodes 归一化为段落
 *  - 折叠列表（details）→ 整块展开：摘要行变段落、内容块原样留在下方
 *
 * 只在「光标位于当前文本块最前面（parentOffset === 0）」时介入，其它退格保持默认行为。
 */
export const ListBackspaceFix = Extension.create({
  name: "listBackspaceFix",

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this;
        const { selection } = editor.state;
        if (!selection.empty) return false;

        const { $from } = selection;
        // 光标必须在当前文本块最前面
        if ($from.parentOffset !== 0) return false;

        // 代码块本身就是文本块（内部没有再包段落），单独判断
        if ($from.parent.type.name === "codeBlock") {
          if (editor.can().clearNodes()) return editor.commands.clearNodes();
          return false;
        }

        // 从光标所在段落向外逐层寻找最近的「结构块」祖先
        for (let depth = $from.depth - 1; depth >= 1; depth--) {
          const node = $from.node(depth);
          const typeName = node.type.name;

          if (typeName === "listItem" || typeName === "taskItem") {
            // 仅当光标处于该列表项的第一个子块开头时才抬回正文，
            // 否则（比如列表项里的第二段）交给默认行为，避免破坏嵌套内容
            if ($from.index(depth) !== 0) return false;
            return editor.commands.liftListItem(typeName);
          }

          if (typeName === "blockquote" || typeName === "callout") {
            if (editor.can().clearNodes()) return editor.commands.clearNodes();
            return false;
          }

          if (typeName === "detailsSummary") {
            return unwrapDetails(editor, $from, depth);
          }
        }

        return false;
      },
    };
  },
});

/**
 * 把折叠列表整块展开为普通块：
 * details = [detailsSummary, detailsContent]，
 * 展开后 = 摘要行转成一个段落 + detailsContent 里的各个块原样保留在其后。
 * （clearNodes 会破坏 details 的 schema，所以这里手动整块替换。）
 */
function unwrapDetails(
  editor: import("@tiptap/core").Editor,
  $from: import("@tiptap/pm/model").ResolvedPos,
  summaryDepth: number
): boolean {
  const detailsDepth = summaryDepth - 1;
  if (detailsDepth < 0) return false;

  const detailsNode = $from.node(detailsDepth);
  if (detailsNode.type.name !== "details") return false;

  const detailsPos = $from.before(detailsDepth);
  const summaryNode = detailsNode.child(0);
  const summaryText = summaryNode.textContent;

  const replacements: JSONContent[] = [
    summaryText
      ? { type: "paragraph", content: [{ type: "text", text: summaryText }] }
      : { type: "paragraph" },
  ];
  // detailsContent（若存在）里的块原样搬到摘要段落下方
  if (detailsNode.childCount > 1) {
    const contentNode = detailsNode.child(1);
    contentNode.forEach((child) => replacements.push(child.toJSON() as JSONContent));
  }

  const nodes = replacements.map((json) => editor.schema.nodeFromJSON(json));

  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.replaceWith(detailsPos, detailsPos + detailsNode.nodeSize, nodes).scrollIntoView();
      }
      return true;
    })
    .run();
}
