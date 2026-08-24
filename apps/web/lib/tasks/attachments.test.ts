import { describe, expect, it } from "vitest";
import {
  MAX_TASK_ATTACHMENT_BYTES,
  buildTaskAttachmentPath,
  formatAttachmentSize,
  getAttachmentPreviewKind,
  validateTaskAttachment,
} from "./attachments";

describe("task attachments", () => {
  it("按 MIME 类型和扩展名判断预览方式", () => {
    expect(getAttachmentPreviewKind("image/png", "file.bin")).toBe("image");
    expect(getAttachmentPreviewKind("application/pdf", "file.bin")).toBe("pdf");
    expect(getAttachmentPreviewKind(null, "notes.md")).toBe("text");
    expect(getAttachmentPreviewKind(null, "archive.zip")).toBe("other");
  });

  it("格式化附件大小", () => {
    expect(formatAttachmentSize(null)).toBe("");
    expect(formatAttachmentSize(800)).toBe("800 B");
    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
    expect(formatAttachmentSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("拒绝空文件和超限文件", () => {
    expect(validateTaskAttachment({ name: "empty.txt", size: 0 })).toBe("不能上传空文件");
    expect(validateTaskAttachment({ name: "large.zip", size: MAX_TASK_ATTACHMENT_BYTES + 1 })).toBe("附件不能超过 50 MB");
    expect(validateTaskAttachment({ name: "ok.txt", size: 1 })).toBeNull();
  });

  it("生成用户隔离且不含路径分隔符的对象路径", () => {
    expect(buildTaskAttachmentPath("user-1", "task-1", "../报告.pdf", 123))
      .toBe("user-1/tasks/task-1/123-.._报告.pdf");
  });
});
