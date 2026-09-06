/**
 * F01：键盘提交的输入法（IME）组合态守卫。
 *
 * 中文/日文/韩文输入法在选字确认时也会触发 Enter 键事件，此时 event.isComposing
 * 为 true（部分平台用 keyCode 229 表达）。提交快捷键处理前必须先检查，
 * 否则「确认候选字」会被误当作「提交内容」。
 *
 * 统一从这里导入，不要在调用点手写 isComposing 判断（刘海主速记框是最早的实现，
 * 其余入口按此对齐）。
 */
export function isImeComposing(event: {
  nativeEvent?: { isComposing?: boolean };
  keyCode?: number;
}): boolean {
  return Boolean(event.nativeEvent?.isComposing) || event.keyCode === 229;
}
