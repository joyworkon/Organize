// B03 note_links 回填 + 对账驱动脚本（真实后端，非 CI）
//
// 用法（前置：本地 Supabase 运行中；生产环境须显式注入 service key 并自行评估窗口）：
//   cd apps/web && npx tsx scripts/backfill-note-links.mts                # 回填 + 末尾对账
//   cd apps/web && npx tsx scripts/backfill-note-links.mts --reconcile    # 仅对账（只读）
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-note-links.mts
//
// 行为：
//   - 回填：rebuild_note_links_batch 按 notes.id keyset 分批循环至取尽（幂等，
//     可与线上写入并存，可中断重跑）；结束后自动跑一轮全量对账。
//   - 对账（--reconcile 或回填末尾）：reconcile_note_links 全量对比期望边集与
//     现存边集，mismatched > 0 时以非零码退出（可作切读门槛的守门命令）。
//
// 切读门槛（设计 §5）：全量对账连续两轮 mismatched = 0。
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const RECONCILE_ONLY = process.argv.includes("--reconcile");
const BATCH = Number(process.env.BACKFILL_BATCH ?? 500);

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const URL = process.env.SUPABASE_URL ?? status.API_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（或本地 supabase status）");
  process.exit(2);
}

// rebuild/reconcile 仅授予 service_role；persistSession 关闭 + 显式 Bearer，
// 与 backup-restore-drill 的 serviceDb 同理由（避免会话语义混淆）
const serviceDb = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
});

function fail(label: string, error: unknown): never {
  console.error(`✗ ${label}:`, error);
  process.exit(2);
}

async function reconcileOnce(): Promise<number> {
  let after: string | null = null;
  let checked = 0;
  let mismatched = 0;
  let rounds = 0;

  for (;;) {
    const { data, error } = await serviceDb.rpc("reconcile_note_links", {
      p_batch_size: BATCH,
      p_after: after,
    });
    if (error) fail("reconcile_note_links", error);
    const result = data as { checked: number; mismatched: number; last_id: string | null; sample: unknown[] };
    checked += result.checked;
    mismatched += result.mismatched;
    for (const item of result.sample ?? []) {
      console.error("  漂移样本:", JSON.stringify(item));
    }
    rounds += 1;
    if (rounds > 100_000) fail("reconcile 循环守卫触发", new Error("last_id 未推进"));
    if (!result.last_id || result.checked === 0) break;
    after = result.last_id;
  }

  console.log(`对账完成：checked=${checked} mismatched=${mismatched}`);
  return mismatched;
}

async function backfill(): Promise<void> {
  let after: string | null = null;
  let total = 0;
  let rounds = 0;

  console.log(`开始回填（batch=${BATCH}）…`);
  for (;;) {
    const { data, error } = await serviceDb.rpc("rebuild_note_links_batch", {
      p_batch_size: BATCH,
      p_after: after,
    });
    if (error) fail("rebuild_note_links_batch", error);
    const result = data as { processed: number; last_id: string | null };
    total += result.processed;
    rounds += 1;
    if (rounds % 20 === 0 || result.processed === 0) {
      console.log(`  已处理 ${total} 篇（last_id=${result.last_id ?? "取尽"}）`);
    }
    if (rounds > 100_000) fail("backfill 循环守卫触发", new Error("last_id 未推进"));
    if (!result.last_id || result.processed === 0) break;
    after = result.last_id;
  }
  console.log(`回填完成：共 ${total} 篇`);
}

if (RECONCILE_ONLY) {
  const mismatched = await reconcileOnce();
  process.exit(mismatched > 0 ? 1 : 0);
}

await backfill();
console.log("回填后对账：");
const mismatched = await reconcileOnce();
process.exit(mismatched > 0 ? 1 : 0);
