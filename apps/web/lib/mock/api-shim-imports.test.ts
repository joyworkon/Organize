// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// 阶段 D /api/imports 的 mock shim 路由测试：
// 文本路径真解析真建条目；PDF/DOCX/XLSX 与 image/audio 诚实失败（不伪造成功）；
// retry_key 幂等（重复提交不重复建条目）；GET 恢复列表与真实路由同形状。
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const call = async (path: string, init?: RequestInit) => {
  const res = await (window as any).fetch(path, init);
  return { status: res.status, body: await res.json() };
};

let originalFetchRef: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  originalFetchRef = vi.fn(async () => new Response("{}", { status: 200 }));
  (window as any).fetch = originalFetchRef;
  delete (window as any).__organizeMockApiShimInstalled;
  const mod = await import("@/lib/mock/api-shim");
  mod.installMockApiShim();
  const { mockDb } = await import("@/lib/supabase/mock-data");
  // 每个用例前清空导入记录（种子不带）
  mockDb.import_tasks = [];
  mockDb.import_files = [];
});

const mdFile = (name = "要点.md") =>
  new File(["# 测试标题\n\n- 甲\n- 乙"], name, { type: "text/markdown" });

describe("mock api shim: /api/imports", () => {
  it("markdown 文件：真解析 + 真建阅读条目（URN 去重键），状态 saved", async () => {
    const form = new FormData();
    form.append("files", mdFile());
    form.append("retryKeys", "rk-md-1");
    const { status, body } = await call("/api/imports", { method: "POST", body: form });
    expect(status).toBe(200);
    expect(body.task.status).toBe("saved");
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({
      fileName: "要点.md", kind: "markdown", status: "saved",
    });
    expect(body.files[0].readingItemId).toBeTruthy();

    const { mockDb } = await import("@/lib/supabase/mock-data");
    const item = mockDb.reading_items.find((r: any) => r.id === body.files[0].readingItemId);
    expect(item.title).toBe("测试标题");
    expect(item.url).toMatch(/^urn:organize:import:[a-f0-9]{64}$/);
    expect(item.content).toContain("<ul><li>甲</li><li>乙</li></ul>");
    expect(item.reading_status).toBe("unread");
  });

  it("幂等：同 retryKey 重复提交返回既有记录，不重复建条目", async () => {
    const form = new FormData();
    form.append("files", mdFile());
    form.append("retryKeys", "rk-dedup");
    const first = await call("/api/imports", { method: "POST", body: form });
    const second = await call("/api/imports", { method: "POST", body: form });
    expect(first.body.files[0].readingItemId).toBe(second.body.files[0].readingItemId);

    const { mockDb } = await import("@/lib/supabase/mock-data");
    const items = mockDb.reading_items.filter(
      (r: any) => typeof r.url === "string" && r.url.startsWith("urn:organize:import:"),
    );
    expect(items).toHaveLength(1);
    // 两个任务行各自存在，但第二个任务的文件行指向同一结果（幂等返回）
    expect(mockDb.import_files.filter((f: any) => f.retry_key === "rk-dedup")).toHaveLength(1);
  });

  it("内容去重：同文件内容不同 retryKey → duplicate 语义（指向既有条目）", async () => {
    const form1 = new FormData();
    form1.append("files", mdFile("a.md"));
    form1.append("retryKeys", "rk-a");
    await call("/api/imports", { method: "POST", body: form1 });
    const form2 = new FormData();
    form2.append("files", mdFile("b.md")); // 同名内容不同文件名
    form2.append("retryKeys", "rk-b");
    const { body } = await call("/api/imports", { method: "POST", body: form2 });
    expect(body.files[0].status).toBe("saved");
    const { mockDb } = await import("@/lib/supabase/mock-data");
    const items = mockDb.reading_items.filter(
      (r: any) => typeof r.url === "string" && r.url.startsWith("urn:organize:import:"),
    );
    expect(items).toHaveLength(1);
  });

  it("PDF/DOCX/XLSX：诚实失败（mock 不伪造解析成功）", async () => {
    const form = new FormData();
    form.append("files", new File(["%PDF-fake"], "doc.pdf", { type: "application/pdf" }));
    form.append("retryKeys", "rk-pdf");
    form.append("files", new File(["PK-fake"], "doc.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    form.append("retryKeys", "rk-docx");
    const { status, body } = await call("/api/imports", { method: "POST", body: form });
    expect(status).toBe(200);
    expect(body.task.status).toBe("failed");
    expect(body.files[0]).toMatchObject({ status: "failed", kind: "pdf" });
    expect(body.files[0].error).toContain("mock 后端不支持解析");
    expect(body.files[1].error).toContain("mock 后端不支持解析");
  });

  it("图片/音频：诚实失败（mock 无原件存储）", async () => {
    const form = new FormData();
    form.append("files", new File(["fake-png"], "pic.png", { type: "image/png" }));
    form.append("retryKeys", "rk-img");
    const { body } = await call("/api/imports", { method: "POST", body: form });
    expect(body.files[0].status).toBe("failed");
    expect(body.files[0].error).toContain("原件存储");
  });

  it("部分成功：任务状态 partial，失败项可单独重试", async () => {
    const form = new FormData();
    form.append("files", mdFile("ok.md"));
    form.append("retryKeys", "rk-ok");
    form.append("files", new File(["bad"], "doc.pdf", { type: "application/pdf" }));
    form.append("retryKeys", "rk-bad");
    const { body } = await call("/api/imports", { method: "POST", body: form });
    expect(body.task.status).toBe("partial");
    expect(body.files.map((f: any) => f.status)).toEqual(["saved", "failed"]);

    // 失败项重试（同 retryKey）：仍诚实失败且不产生新行
    const retry = new FormData();
    retry.append("files", new File(["bad"], "doc.pdf", { type: "application/pdf" }));
    retry.append("retryKeys", "rk-bad");
    const again = await call("/api/imports", { method: "POST", body: retry });
    expect(again.body.files[0].status).toBe("failed");
    const { mockDb } = await import("@/lib/supabase/mock-data");
    expect(mockDb.import_files.filter((f: any) => f.retry_key === "rk-bad")).toHaveLength(1);
  });

  it("超预算整批拒绝：>6 个文件 400，不建任务行", async () => {
    const form = new FormData();
    for (let i = 0; i < 7; i++) {
      form.append("files", mdFile(`f${i}.md`));
      form.append("retryKeys", `rk-${i}`);
    }
    const { status, body } = await call("/api/imports", { method: "POST", body: form });
    expect(status).toBe(400);
    expect(body.error).toContain("最多导入 6 个");
    const { mockDb } = await import("@/lib/supabase/mock-data");
    expect(mockDb.import_tasks).toHaveLength(0);
  });

  it("GET /api/imports：形状与真实路由一致（{ files: ImportFileResult[] }）", async () => {
    const form = new FormData();
    form.append("files", mdFile());
    form.append("retryKeys", "rk-get");
    await call("/api/imports", { method: "POST", body: form });
    const { status, body } = await call("/api/imports?limit=10");
    expect(status).toBe(200);
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({
      id: expect.any(String), taskId: expect.any(String), fileName: "要点.md",
      kind: "markdown", status: "saved", error: null,
      readingItemId: expect.any(String), createdAt: expect.any(String),
    });
  });
});
