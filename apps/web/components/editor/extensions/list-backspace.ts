import { Extension } from "@tiptap/core";

/**
 * 块首退格修正：当光标在一个「带标记/样式的结构块」最前面按退格时，
 * 先退化成普通正文段落（光标原地不动），而不是沿用 TipTap 默认行为
 * （把内容合并进上一块，光标跳到上一块，且删不掉序号 / 圆点 / 方块 / ▶ 等标记）。
 *
 * 覆盖的块类型：
 *  - 项目符号列表 / 编号列表（listItem）、待办列表（taskItem）→ liftListItem 抬回正文（嵌套时只抬一级）
 *  - 引用（blockquote）、标注（callout）→ lift 把当前段落从包裹中抬出
 *  - 代码块（codeBlock）→ clearNodes 归一化为段落
 *  - 标题（heading）→ clearNodes 归一化为段落
 *  - 折叠列表（details 的 detailsSummary）→ 整块展开：摘要行变段落、内容块原样留在下方
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

        const parentName = $from.parent.type.name;

        // 代码块 / 标题本身就是文本块（内部没有再包段落），直接归一化为段落
        if (parentName === "codeBlock" || parentName === "heading") {
          if (editor.can().clearNodes()) return editor.commands.clearNodes();
          return false;
        }

        // 折叠列表的摘要行：整块展开（见 unwrapDetails）
        if (parentName === "detailsSummary") {
          return unwrapDetails(editor, $from, $from.depth);
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
            // 仅当光标处于包裹内第一个子块开头时才把段落抬出包裹；
            // clearNodes 对「内部已是普通段落」的包裹块无效（会回落成默认退格、光标跳到上一块），
            // lift 把当前段落从包裹中抬出，光标原地不动。
            if ($from.index(depth) !== 0) return false;
            if (editor.can().lift("paragraph")) return editor.commands.lift("paragraph");
            return false;
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

  // 摘要行转成段落，保留加粗/链接等行内格式（不能直接 textContent 拼纯文本）
  const paragraphType = editor.schema.nodes.paragraph;
  const summaryParagraph = paragraphType.create(null, summaryNode.content);
  const replacements: import("@tiptap/pm/model").Node[] = [summaryParagraph];
  // detailsContent（若存在）里的块原样搬到摘要段落下方
  if (detailsNode.childCount > 1) {
    const contentNode = detailsNode.child(1);
    contentNode.forEach((child) => replacements.push(child));
  }

  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.replaceWith(detailsPos, detailsPos + detailsNode.nodeSize, replacements).scrollIntoView();
      }
      return true;
    })
    .run();
}
