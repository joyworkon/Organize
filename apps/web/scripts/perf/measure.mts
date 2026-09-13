// B02 完整性能测量驱动（非 CI，本地真实后端 + 生产构建专用）
//
// 用法（前置：supabase start + 生产构建已起 :3100，env 照抄 ci.yml collab-e2e
// job 的真实后端组合，不配 NEXT_PUBLIC_COLLAB_WS_URL = 协作关闭走乐观锁主链，
// 与 R12 口径一致）：
//   cd apps/web && npx tsx scripts/perf/measure.mts
// 可调：ROUNDS（默认 3）、BASE_URL（默认 http://127.0.0.1:3100）
//
// 产出：/tmp/b02-measure.json（全量原始数据）+ 控制台 markdown 汇总表
// （中位数+范围）。报告由人（或后续步骤）据 JSON 落 docs/handoff/b02-measurement.md。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const FILTER = process.env.FILTER ?? "";
const EDITOR_TIMEOUT_MS = Number(process.env.EDITOR_TIMEOUT_MS ?? 60_000);
const RUN = Date.now().toString(36);
const PASSWORD = `b02-perf-${RUN}-password`;
const EMAIL = `perf-b02-${RUN}@test.local`;

// 固定随机种子（报告记录）：样本文本可复现
const SEED = 0xb02f00d;
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
// 400 个常用双字汉字池，按种子乱序取样拼接（避免重复句式的 V8 优化偏差）
const CHAR_POOL = Array.from({ length: 400 }, () =>
  String.fromCharCode(0x4e00 + Math.floor(rng() * 3000))
);
function chineseText(chars: number): string {
  let out = "";
  while (out.length < chars) {
    out += CHAR_POOL[Math.floor(rng() * CHAR_POOL.length)];
  }
  return out.slice(0, chars);
}

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const URL = process.env.SUPABASE_URL ?? status.API_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? status.ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;
const admin: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
});

// 1×1 PNG（注入图片统一由 page.route 就地 fulfill，消除网络与远图噪声）
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function ensureUser(): Promise<{ id: string; password: string }> {
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list.data?.users?.find((u) => u.email === EMAIL);
  if (existing) return { id: existing.id, password: PASSWORD };
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  return { id: data.user.id, password: PASSWORD };
}

function paragraphNodes(chars: number, paragraphs = 0): unknown[] {
  const text = chineseText(chars);
  const nodes: unknown[] = [];
  const size = paragraphs > 0 ? Math.ceil(chars / paragraphs) : chars;
  if (paragraphs === 0) {
    nodes.push({ type: "paragraph", content: [{ type: "text", text }] });
    return nodes;
  }
  for (let i = 0; i < text.length; i += size) {
    nodes.push({
      type: "paragraph",
      content: [{ type: "text", text: text.slice(i, i + size) }],
    });
  }
  return nodes;
}

function imageBlocks(count: number): unknown[] {
  // image 是块级节点（ResizableImage extends Image），不能嵌进 paragraph content
  return Array.from({ length: count }, (_, i) => [
    {
      type: "paragraph",
      content: [{ type: "text", text: `图 ${i + 1}：` }],
    },
    { type: "image", attrs: { src: `/perf-img/${i}.png`, alt: `perf-${i}` } },
  ]).flat();
}

function tableSample(rows: number, cols: number): unknown[] {
  const header = {
    type: "tableRow",
    content: Array.from({ length: cols }, (_, c) => ({
      type: "tableHeader",
      attrs: { colspan: c === 1 && cols > 3 ? 2 : 1 },
      content: [{ type: "text", text: `列${c + 1}` }],
    })),
  };
  const body = Array.from({ length: rows }, (_, r) => ({
    type: "tableRow",
    content: Array.from({ length: cols }, (_, c) => {
      if (c === 1 && cols > 3 && r % 5 === 0) return null; // 与表头 colspan 对齐省略
      return {
        type: "tableCell",
        attrs: {
          colspan: c === 1 && r % 5 === 1 && r + 1 < rows ? 2 : 1,
          backgroundColor: r % 4 === 0 ? "#fef3c7" : r % 4 === 2 ? "#dbeafe" : null,
        },
        content: [{ type: "text", text: `单元格 ${r}-${c} ${chineseText(8)}` }],
      };
    }).filter(Boolean),
  }));
  return [{ type: "table", content: [header, ...body] }];
}

function listSample(items: number): unknown[] {
  return [
    {
      type: "bulletList",
      content: Array.from({ length: items }, (_, i) => ({
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: `条目 ${i + 1}：${chineseText(20)}` }] },
        ],
      })),
    },
  ];
}

async function seedNote(
  ownerId: string,
  title: string,
  content: unknown
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await admin
    .from("notes")
    .insert({ id, user_id: ownerId, title, content, content_revision: 0 });
  if (error) throw new Error(`seed note ${title}: ${error.message}`);
  return id;
}

async function seedGraph(ownerId: string): Promise<void> {
  // 图谱样本：60 篇笔记 × 5 个标签，笔记间内链（反链 RPC 数据面）
  const tagIds: string[] = [];
  for (let t = 0; t < 5; t++) {
    const id = crypto.randomUUID();
    const { error } = await admin
      .from("tags")
      .insert({ id, user_id: ownerId, name: `图谱标签${t + 1}`, color: "blue" });
    if (error) throw new Error(`seed tag: ${error.message}`);
    tagIds.push(id);
  }
  const noteIds: string[] = [];
  for (let n = 0; n < 60; n++) {
    const id = await seedNote(
      ownerId,
      `图谱笔记 ${n + 1}`,
      {
        type: "doc",
        content: paragraphNodes(300, 3),
      }
    );
    noteIds.push(id);
  }
  for (let n = 0; n < noteIds.length; n++) {
    for (let t = 0; t < 5; t++) {
      await admin.from("note_tags").insert({ note_id: noteIds[n], tag_id: tagIds[t] });
    }
    // 每篇内链 3 篇其他笔记
    for (let l = 1; l <= 3; l++) {
      const target = noteIds[(n + l * 7) % noteIds.length];
      await admin
        .from("notes")
        .update({
          content: {
            type: "doc",
            content: [
              ...paragraphNodes(300, 3),
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "相关：" },
                  {
                    type: "text",
                    text: "链接",
                    marks: [{ type: "link", attrs: { href: `/notes/${target}` } }],
                  },
                ],
              },
            ],
          },
        })
        .eq("id", noteIds[n]);
    }
  }
}

const configs: Array<{
  label: string;
  content: unknown;
  typeChars: number;
}> = [
  ...[1000, 10000, 50000].flatMap((chars) =>
    [0, 10, 30].map((images) => ({
      label: `${chars}字×${images}图`,
      content: {
        type: "doc",
        content: [...paragraphNodes(chars, Math.max(1, Math.floor(chars / 200))), ...imageBlocks(images)],
      },
      typeChars: 2000, // 统一打字负载，测「已有大文档上继续输入」的长任务
    }))
  ),
  { label: "复杂表格20x6", content: { type: "doc", content: [...tableSample(20, 6), ...paragraphNodes(1000, 5)] }, typeChars: 2000 },
  { label: "列表1千条", content: { type: "doc", content: listSample(1000) }, typeChars: 1000 },
  { label: "列表1万条", content: { type: "doc", content: listSample(10000) }, typeChars: 0 },
];

interface RoundResult {
  round: number;
  coldOpenMs: number | null;
  typeTotalMs: number | null;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  inpMaxMs: number;
  savePosts: number;
  saveFailures: number;
  avgSaveMs: number | null;
  saveDurationsMs: number[];
  draftBytesMax: number;
  draftWriteCount: number;
  serializationAvgMs: number | null;
  memoryAfterMb: number | null;
  reopenMs: number | null;
  error?: string;
}

async function newLoggedInContext(
  browser: Browser,
  email: string,
  password: string
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/perf-img/**", (route) =>
    route.fulfill({ status: 200, body: PNG_1PX, contentType: "image/png" })
  );
  await page.goto(`${BASE_URL}/login`);
  // 新账号首次进入会弹 onboarding 引导（遮罩拦截编辑器点击）——登录前预置完成标记
  await page.evaluate(() => localStorage.setItem("organize:onboarded", "1"));
  await page.getByPlaceholder("邮箱地址").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.close();
  return context;
}

async function timeEditorInteractive(page: Page, noteId: string): Promise<number> {
  const start = Date.now();
  await page.goto(`${BASE_URL}/notes/${noteId}`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor({ state: "visible", timeout: EDITOR_TIMEOUT_MS });
  await editor.click();
  return Date.now() - start;
}

async function typeIntoEditor(page: Page, chars: number, batchSize = 500): Promise<number> {
  // 程序化聚焦 + 光标移到文档末尾（点击/End 键在多段落文档上焦点不可靠）
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".ProseMirror");
    el?.focus();
    const sel = window.getSelection();
    if (el && sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
  const start = Date.now();
  const text = chineseText(chars);
  for (let i = 0; i < chars; i += batchSize) {
    await page.keyboard.insertText(text.slice(i, i + batchSize));
    await page.waitForTimeout(10);
  }
  return Date.now() - start;
}

async function drainAndCollect(page: Page): Promise<Omit<RoundResult, "round" | "coldOpenMs" | "typeTotalMs" | "reopenMs">> {
  // 防抖 900ms + 排空余量
  await page.waitForTimeout(2000);
  return await page.evaluate(() => {
    const probe = (window as unknown as { __organizePerf?: { snapshot(): Record<string, unknown> } })
      .__organizePerf;
    const snap = probe?.snapshot() ?? {};
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      longTaskCount: Number(snap.longTaskCount ?? 0),
      longTaskTotalMs: Number(snap.longTaskTotalMs ?? 0),
      longTaskMaxMs: Number(snap.longTaskMaxMs ?? 0),
      inpMaxMs: Number(snap.inpMaxMs ?? 0),
      savePosts: Number(snap.savePosts ?? 0),
      saveFailures: Number(snap.saveFailures ?? 0),
      avgSaveMs: snap.avgSaveMs === 0 || snap.avgSaveMs == null ? null : Number(snap.avgSaveMs),
      saveDurationsMs:
        (snap as unknown as { saves?: { durationMs: number }[] }).saves?.map((s2) => s2.durationMs) ?? [],
      draftBytesMax: Number(snap.draftBytesMax ?? 0),
      draftWriteCount: Number(snap.draftWrites ?? 0),
      serializationAvgMs:
        snap.serializationAvgMs == null ? null : Number(snap.serializationAvgMs),
      memoryAfterMb:
        mem && Number.isFinite(mem.usedJSHeapSize)
          ? Math.round(mem.usedJSHeapSize / 1024 / 102.4) / 10
          : null,
    };
  });
}

async function main() {
  const health = await fetch(`${BASE_URL}/api/health`).then(
    (r) => r.ok,
    () => false
  );
  if (!health) throw new Error(`web :3100 未运行（BASE_URL=${BASE_URL}）`);

  const user = await ensureUser();
  const browser = await chromium.launch();

  // 图谱样本（一次性播种，60 笔记 × 5 标签 + 内链）
  await seedGraph(user.id);

  const results: Record<string, RoundResult[]> = {};
  try {
    for (const config of configs) {
      results[config.label] = [];
    }

    for (let round = 1; round <= ROUNDS; round++) {
      // 每轮独立 context（冷开隔离）
      const context = await newLoggedInContext(browser, EMAIL, PASSWORD);
      const page = await context.newPage();
      await page.route("**/perf-img/**", (route) =>
        route.fulfill({ status: 200, body: PNG_1PX, contentType: "image/png" })
      );

      for (const config of configs) {
        if (FILTER && !config.label.includes(FILTER)) continue;
        // 每轮重新播种同起点（上一轮的编辑不污染下一轮样本）
        const noteId = await seedNote(user.id, `性能样本 ${config.label} r${round}`, config.content);
        const roundResult: RoundResult = { round, coldOpenMs: null, typeTotalMs: null, reopenMs: null, longTaskCount: 0, longTaskTotalMs: 0, longTaskMaxMs: 0, inpMaxMs: 0, savePosts: 0, saveFailures: 0, avgSaveMs: null, saveDurationsMs: [], draftBytesMax: 0, draftWriteCount: 0, serializationAvgMs: null, memoryAfterMb: null };
        try {
          // 冷开（新 context 首次打开该笔记页）
          roundResult.coldOpenMs = await timeEditorInteractive(page, noteId);
          // 等初始迁移/一次性保存沉降后再复位仪表（隔离打字驱动的保存计数）
          await page.waitForTimeout(1500);
          await page.evaluate(() => (window as unknown as { __organizePerf?: { reset(): void } }).__organizePerf?.reset());
          if (config.typeChars > 0) {
            roundResult.typeTotalMs = await typeIntoEditor(page, config.typeChars);
            const diag = await page.evaluate(() => ({
              focusInEditor: document.activeElement?.classList?.contains("ProseMirror") ?? false,
              hasProbe: !!(window as unknown as { __organizePerf?: unknown }).__organizePerf,
            }));
            if (!diag.focusInEditor || !diag.hasProbe) {
              console.log(`  >> diag ${config.label}: ${JSON.stringify(diag)}`);
            }
          }
          const collected = await drainAndCollect(page);
          Object.assign(roundResult, collected);
          // 重开（同 context reload，资源热缓存口径）
          const reopenStart = Date.now();
          await page.reload({ waitUntil: "domcontentloaded" });
          const editor = page.locator(".ProseMirror").first();
          await editor.waitFor({ state: "visible", timeout: 60_000 });
          await editor.click();
          roundResult.reopenMs = Date.now() - reopenStart;
        } catch (error) {
          roundResult.error = error instanceof Error ? error.message : String(error);
        }
        results[config.label].push(roundResult);
        const errNote = roundResult.error ? ` ⚠ ${roundResult.error.slice(0, 80)}` : "";
        console.log(
          `[r${round}] ${config.label}: cold=${roundResult.coldOpenMs}ms type=${roundResult.typeTotalMs ?? "—"} lt=${roundResult.longTaskCount} saves=${roundResult.savePosts} draftMax=${(roundResult.draftBytesMax / 1024).toFixed(0)}KB mem=${roundResult.memoryAfterMb ?? "—"}MB reopen=${roundResult.reopenMs ?? "—"}ms${errNote}`
        );
      }
      await context.close();
    }

    // 图谱页测量（数据已播种）：每轮新 context 打开 /graph 计时至图谱容器可见
    results["图谱60笔记×5标签"] = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const context = await newLoggedInContext(browser, EMAIL, PASSWORD);
      const page = await context.newPage();
      const roundResult: RoundResult = { round, coldOpenMs: null, typeTotalMs: null, reopenMs: null, longTaskCount: 0, longTaskTotalMs: 0, longTaskMaxMs: 0, inpMaxMs: 0, savePosts: 0, saveFailures: 0, avgSaveMs: null, saveDurationsMs: [], draftBytesMax: 0, draftWriteCount: 0, serializationAvgMs: null, memoryAfterMb: null };
      try {
        // 失败诊断：抓页面异常与失败请求
        page.on("pageerror", (err) => console.log(`  >> graph pageerror: ${String(err).slice(0, 150)}`));
        page.on("response", (res) => {
          if (res.status() >= 400) console.log(`  >> graph http ${res.status()}: ${res.url().slice(0, 110)}`);
        });
        const start = Date.now();
        await page.goto(`${BASE_URL}/graph`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[aria-label="知识图谱画布"]', { timeout: EDITOR_TIMEOUT_MS });
        roundResult.coldOpenMs = Date.now() - start;
        const collected = await drainAndCollect(page);
        Object.assign(roundResult, collected);
      } catch (error) {
        roundResult.error = error instanceof Error ? error.message : String(error);
      }
      results["图谱60笔记×5标签"].push(roundResult);
      console.log(`[r${round}] 图谱: cold=${roundResult.coldOpenMs}ms err=${roundResult.error ?? "—"}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  mkdirSync("/tmp/b02-perf", { recursive: true });
  writeFileSync(
    "/tmp/b02-perf/measure.json",
    JSON.stringify({ run: RUN, seed: SEED, rounds: ROUNDS, baseUrl: BASE_URL, results }, null, 2)
  );
  console.log("\n原始数据：/tmp/b02-perf/measure.json");

  // 中位数 + 范围汇总
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const range = (xs: number[]) =>
    xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : "—";
  const pick = (rows: RoundResult[], key: keyof RoundResult) =>
    rows.map((r) => r[key]).filter((v): v is number => typeof v === "number" && !Number.isNaN(v));

  console.log("\n| 样本 | 冷开ms | 打字ms | 长任务(次/累计ms/最长) | INPmax | 保存次数 | 平均保存ms | 草稿峰值KB | 序列化ms | 内存MB | 重开ms |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [label, rows] of Object.entries(results)) {
    const fail = rows.filter((r) => r.error).length;
    const fmt = (key: keyof RoundResult, scale = 1) => {
      const vals = pick(rows, key).map((v) => Math.round((v / scale) * 10) / 10);
      return vals.length ? `${median(vals)}（${range(vals)}）` : "—";
    };
    const lt = `${median(pick(rows, "longTaskCount"))} / ${median(pick(rows, "longTaskTotalMs"))} / ${median(pick(rows, "longTaskMaxMs"))}`;
    console.log(
      `| ${label}${fail ? `（${fail}轮失败）` : ""} | ${fmt("coldOpenMs")} | ${fmt("typeTotalMs")} | ${lt} | ${median(pick(rows, "inpMaxMs"))} | ${median(pick(rows, "savePosts"))} | ${fmt("avgSaveMs")} | ${fmt("draftBytesMax", 1024)} | ${fmt("serializationAvgMs")} | ${fmt("memoryAfterMb")} | ${fmt("reopenMs")} |`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
