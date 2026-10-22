import { createElement } from "react";

/**
 * 撤销类 toast 的「撤销」按钮：完成勾选 / 快捷改期 / 拖动改期 / 删除等
 * 多处重复的 createElement 收敛到这一个 helper，样式与历史版本一致。
 */
export function undoToastAction(onUndo: () => void) {
  return createElement(
    "button",
    {
      type: "button",
      className:
        "rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent",
      onClick: onUndo,
    },
    "撤销"
  );
}
