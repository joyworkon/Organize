import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * 块首退格修正：当光标在一个「带标记/样式的结构块」最前面按退格时，
 * 先退化成普通正文段落（光标原地不动），而不是沿用 TipTap 默认行为
 * （把内容合并进上一块，光标跳到上一块，且删不掉序号 / 圆点 / 方块 / ▶ 等标记）。
 *
 * 覆盖的块类型：
 *  - 项目符号列表 / 编号列表（listItem）、待办列表（taskItem）→ liftListItem 抬回正文（嵌套时只抬一级）
 *    · 例外：空列表项直接删除（光标移到上一项末尾），默认行为只会把空段落并进上一项、
 *      项还在；抬回正文则会变成「抬成空段落 ↔ 又被拉回列表」的死循环
 *  - 引用（blockquote）、标注（callout）→ lift 把当前段落从包裹中抬出
 *  - 代码块（codeBlock）→ clearNodes 归一化为段落
 *  - 标题（heading）→ clearNodes 归一化为段落
 *  - 折叠列表（details 的 detailsSummary）→ 整块展开：摘要行变段落、内容块原样留在下方
 *  - 顶层文本块且上一兄弟是列表 → 文本并入列表末项（空块则直接删除，光标进列表末尾），
 *    避免默认行为把段落重新变成一个列表项（上一规则刚抬出来、这一按又变回去的死循环）
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
            // 仅当光标处于该列表项的第一个子块开头时才介入，
            // 否则（比如列表项里的第二段）交给默认行为，避免破坏嵌套内容
            if ($from.index(depth) !== 0) return false;
            // 空列表项：默认 joinBackward 只会把空段落并进上一项、残留一个空行（项还在）。
            // 这里直接把空项删除：光标移到上一项末尾；首个空项仍抬回普通段落。
            if (node.textContent.length === 0) {
              const indexInList = $from.index(depth - 1);
              if (indexInList === 0) return editor.commands.liftListItem(typeName);
              return deleteEmptyListItem(editor, $from.before(depth), node.nodeSize);
            }
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

        // 顶层文本块、上一兄弟是列表：把当前块内容并入列表最后一项（空块直接删除）。
        // 默认 joinBackward 会把段落重新包装成一个列表项 —— 刚从列表里退格抬出来的段落
        // 下一按又变回列表项，用户看到的就是「删掉的元素又恢复了、永远删不上去」。
        if ($from.depth === 1 && $from.parent.isTextblock) {
          const blockPos = $from.before(1);
          const $block = editor.state.doc.resolve(blockPos);
          const previous = $block.nodeBefore;
          if (previous && LIST_TYPES.has(previous.type.name)) {
            return mergeIntoListEnd(editor, blockPos, $from.parent.content.size);
          }
        }

        return false;
      },
    };
  },
});

/**
 * 把 blockPos 处的顶层文本块并入上一个列表的末尾：
 *  - 非空块：行内内容追加到列表最后一个文本块末尾，光标留在合并点（下次退格正常删字）
 *  - 空块：直接删除，光标落在列表末尾
 */
function mergeIntoListEnd(
  editor: import("@tiptap/core").Editor,
  blockPos: number,
  contentSize: number
): boolean {
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        const block = tr.doc.nodeAt(blockPos);
        if (!block) return false;
        // 列表末尾的文本位置（删除前定位，删除不影响它前面的位置）
        const joinAt = TextSelection.near(tr.doc.resolve(blockPos - 1), -1).from;
        tr.delete(blockPos, blockPos + block.nodeSize);
        if (contentSize > 0) {
          tr.insert(joinAt, block.content);
        }
        tr.setSelection(TextSelection.near(tr.doc.resolve(joinAt), 1)).scrollIntoView();
      }
      return true;
    })
    .run();
}

/** 删除空列表项，光标移到上一项末尾。 */
function deleteEmptyListItem(
  editor: import("@tiptap/core").Editor,
  itemPos: number,
  itemSize: number
): boolean {
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        // 上一项末尾的文本位置（在 itemPos 之前，不受删除影响）
        const before = TextSelection.near(tr.doc.resolve(itemPos - 1), -1).from;
        tr.delete(itemPos, itemPos + itemSize);
        tr.setSelection(TextSelection.near(tr.doc.resolve(before), 1)).scrollIntoView();
      }
      return true;
    })
    .run();
}

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
