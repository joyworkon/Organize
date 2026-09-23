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
let userId: string;

beforeEach(async () => {
  vi.resetModules();
  originalFetchRef = vi.fn(async () => new Response("{}", { status: 200 }));
  (window as any).fetch = originalFetchRef;
  delete (window as any).__organizeMockApiShimInstalled;
  const mod = await import("@/lib/mock/api-shim");
  mod.installMockApiShim();
  const { mockDb, MOCK_USER } = await import("@/lib/supabase/mock-data");
  userId = MOCK_USER.id as string;
  // 每个用例前清空导入记录（种子不带）
  mockDb.import_tasks = [];
  mockDb.import_files = [];
});

const mdFile = (name = "要点.md") =>
  new File(["# 测试标题\n\n- 甲\n- 乙"], name, { type: "text/markdown" });

const formWith = (retryKey: string) => {
  const form = new FormData();
  form.append("files", mdFile());
  form.append("retryKeys", retryKey);
  return form;
};


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

  it("GET /api/imports：形状与真实路由一致（{ files, nextCursor }，含 retryKey 供列表重试复用）", async () => {
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
      retryKey: "rk-get",
    });
    expect(body.nextCursor).toBeNull();
  });

  it("GET 分页：cursor 翻页不重不漏（created_at DESC, id DESC）", async () => {
    for (let i = 0; i < 5; i++) {
      const form = new FormData();
      form.append("files", mdFile(`page-${i}.md`));
      form.append("retryKeys", `rk-page-${i}`);
      await call("/api/imports", { method: "POST", body: form });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const { body } = await call(
        `/api/imports?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(body.files.length).toBeLessThanOrEqual(2);
      seen.push(...body.files.map((f: any) => f.retryKey));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen.sort()).toEqual([
      "rk-page-0", "rk-page-1", "rk-page-2", "rk-page-3", "rk-page-4",
    ]);
  });

  it("中断恢复：GET 把超阈值的 uploading/parsing 行标记 failed，并重算任务状态", async () => {
    const { mockDb } = await import("@/lib/supabase/mock-data");
    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const taskId = "import_task_stale";
    mockDb.import_tasks.push({
      id: taskId, user_id: userId, status: "processing",
      created_at: stale, updated_at: stale,
    });
    mockDb.import_files.push(
      {
        id: "import_file_stale_upload", task_id: taskId, user_id: userId,
        file_name: "中断的上传.pdf", mime: "application/pdf", size: 10, kind: "pdf",
        retry_key: "rk-stale-upload", status: "uploading", error: null,
        reading_item_id: null, page_count: null,
        created_at: stale, updated_at: stale,
      },
      {
        id: "import_file_fresh", task_id: taskId, user_id: userId,
        file_name: "刚提交.md", mime: "text/markdown", size: 10, kind: "markdown",
        retry_key: "rk-fresh", status: "uploading", error: null,
        reading_item_id: null, page_count: null,
        created_at: fresh, updated_at: fresh,
      },
    );

    const { body } = await call("/api/imports");
    const staleRow = body.files.find((f: any) => f.retryKey === "rk-stale-upload");
    const freshRow = body.files.find((f: any) => f.retryKey === "rk-fresh");
    expect(staleRow.status).toBe("failed");
    expect(staleRow.error).toContain("中断");
    expect(freshRow.status).toBe("uploading"); // 未超阈值的不动
    // 任务状态随之重算：仍有在途行 → processing 保持
    expect(mockDb.import_tasks.find((t: any) => t.id === taskId).status).toBe("processing");

    // 现在把最后一行也变为 stale → 再 GET → 任务收口为 failed
    const row = mockDb.import_files.find((f: any) => f.retry_key === "rk-fresh");
    row.updated_at = stale;
    await call("/api/imports");
    expect(mockDb.import_tasks.find((t: any) => t.id === taskId).status).toBe("failed");
  });

  it("中断恢复：POST 对 stale 的非 failed 行原地重跑（文本），不产生第二行", async () => {
    const { mockDb } = await import("@/lib/supabase/mock-data");
    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    mockDb.import_tasks.push({
      id: "import_task_stale2", user_id: userId, status: "processing",
      created_at: stale, updated_at: stale,
    });
    mockDb.import_files.push({
      id: "import_file_stale2", task_id: "import_task_stale2", user_id: userId,
      file_name: "要点.md", mime: "text/markdown", size: 10, kind: "markdown",
      retry_key: "rk-stale-rerun", status: "parsing", error: null,
      reading_item_id: null, page_count: null,
      created_at: stale, updated_at: stale,
    });

    // 非 stale 的同键提交：幂等返回进行中记录（不重跑）
    const inflightForm = new FormData();
    inflightForm.append("files", mdFile());
    inflightForm.append("retryKeys", "rk-stale-rerun");
    // 把 updated_at 改回新鲜值 → 幂等返回
    mockDb.import_files.find((f: any) => f.retry_key === "rk-stale-rerun").updated_at = new Date().toISOString();
    const inflight = await call("/api/imports", { method: "POST", body: inflightForm });
    expect(inflight.body.files[0].status).toBe("parsing");

    // stale 后同键提交 → 原地重跑成功
    mockDb.import_files.find((f: any) => f.retry_key === "rk-stale-rerun").updated_at = stale;
    const rerun = await call("/api/imports", { method: "POST", body: inflightForm });
    expect(rerun.body.files[0].status).toBe("saved");
    expect(rerun.body.files[0].retryKey).toBe("rk-stale-rerun");
    expect(mockDb.import_files.filter((f: any) => f.retry_key === "rk-stale-rerun")).toHaveLength(1);
    const items = mockDb.reading_items.filter(
      (r: any) => typeof r.url === "string" && r.url.startsWith("urn:organize:import:"),
    );
    expect(items).toHaveLength(1);
  });

  it("并发同键：两个在途 POST 同 retryKey 只落一行、一个条目", async () => {
    const [a, b] = await Promise.all([
      call("/api/imports", { method: "POST", body: formWith("rk-race") }),
      call("/api/imports", { method: "POST", body: formWith("rk-race") }),
    ]);
    expect(a.body.files[0].status).toBe("saved");
    expect(b.body.files[0].status).toBe("saved");
    expect(a.body.files[0].readingItemId).toBe(b.body.files[0].readingItemId);
    const { mockDb } = await import("@/lib/supabase/mock-data");
    expect(mockDb.import_files.filter((f: any) => f.retry_key === "rk-race")).toHaveLength(1);
    expect(mockDb.reading_items.filter(
      (r: any) => typeof r.url === "string" && r.url.startsWith("urn:organize:import:"),
    )).toHaveLength(1);
  });

  it("重试成功后任务状态重算：partial → saved（失败项修好即收口）", async () => {
    // mock 的 PDF 诚实失败不可修复；用「stale 上传行原地重跑成功」驱动重算：
    // 任务含 1 个 saved 文本 + 1 个 stale 上传行 → 重跑 stale 行成功 → 任务 saved
    const { mockDb } = await import("@/lib/supabase/mock-data");
    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    mockDb.import_tasks.push({
      id: "import_task_mixed", user_id: userId, status: "partial",
      created_at: stale, updated_at: stale,
    });
    mockDb.import_files.push({
      id: "import_file_mixed_ok", task_id: "import_task_mixed", user_id: userId,
      file_name: "已保存.md", mime: "text/markdown", size: 10, kind: "markdown",
      retry_key: "rk-mixed-ok", status: "saved", error: null,
      reading_item_id: null, page_count: null,
      created_at: stale, updated_at: stale,
    }, {
      id: "import_file_mixed_stale", task_id: "import_task_mixed", user_id: userId,
      file_name: "要点.md", mime: "text/markdown", size: 10, kind: "markdown",
      retry_key: "rk-mixed-stale", status: "uploading", error: null,
      reading_item_id: null, page_count: null,
      created_at: stale, updated_at: stale,
    });

    const form = new FormData();
    form.append("files", mdFile());
    form.append("retryKeys", "rk-mixed-stale");
    const { body } = await call("/api/imports", { method: "POST", body: form });
    expect(body.files[0].status).toBe("saved");
    expect(body.task.id).toBe("import_task_mixed");
    expect(body.task.status).toBe("saved");
    expect(mockDb.import_tasks.find((t: any) => t.id === "import_task_mixed").status).toBe("saved");
  });

  it("同名文件不错配：一批两个同名（内容不同）文件 → 两行、两键、两个条目", async () => {
    const form = new FormData();
    form.append("files", new File(["# 内容甲"], "同名.md", { type: "text/markdown" }));
    form.append("retryKeys", "rk-name-a");
    form.append("files", new File(["# 内容乙完全不同"], "同名.md", { type: "text/markdown" }));
    form.append("retryKeys", "rk-name-b");
    const { body } = await call("/api/imports", { method: "POST", body: form });
    expect(body.files).toHaveLength(2);
    expect(body.files.map((f: any) => f.retryKey).sort()).toEqual(["rk-name-a", "rk-name-b"]);
    expect(body.files[0].readingItemId).not.toBe(body.files[1].readingItemId);
  });
});
