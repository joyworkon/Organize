import { extractFirstUrl } from "@/lib/inbox/batch-import";

/**
 * 统一快速记录的类型识别（工作台输入框与「＋」快速新建面板共用）：
 * - 含 http(s) 链接 → 稍后读（url）
 * - 以「待办:」「todo:」「[ ]」「- [ ]」开头 → 待办（task），前缀会被去掉
 * - 其余 → 速记（memo）
 * 识别结果只是默认值，用户可以在面板里改选其它类型。
 */
export type CaptureKind = "url" | "task" | "memo";

export const CAPTURE_KIND_LABEL: Record<CaptureKind, string> = {
  url: "稍后读",
  task: "待办",
  memo: "速记",
};

const TASK_PREFIX = /^\s*(?:-\s*)?(?:\[\s?\]|todo[:：]|待办[:：])\s*/i;

export function detectCapture(raw: string): { kind: CaptureKind; text: string } {
  const value = raw.trim();
  if (!value) return { kind: "memo", text: "" };
  if (extractFirstUrl(value)) return { kind: "url", text: value };
  if (TASK_PREFIX.test(value)) {
    const text = value.replace(TASK_PREFIX, "").trim();
    if (text) return { kind: "task", text };
  }
  return { kind: "memo", text: value };
}
