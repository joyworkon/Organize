import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

interface DailyBucket {
  date: string; // YYYY-MM-DD
  count: number;
}

interface StatsResponse {
  totals: {
    items: number;
    notes: number;
    unread: number;
    reading: number;
    read: number;
    pinned: number;
  };
  averageProgress: number;
  // 最近 N 天每天新建的文章数
  dailyItems: DailyBucket[];
  // 最近 N 天每天标记为已读的文章数（按 updated_at）
  dailyRead: DailyBucket[];
  // 最热标签 Top 5（按总使用次数）
  topTags: Array<{ id: string; name: string; count: number }>;
  // 来源站点 Top 5（按 URL host 聚合）
  topSources: Array<{ host: string; count: number }>;
}

const DAYS = 30;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const since = new Date();
  since.setDate(since.getDate() - (DAYS - 1));
  const sinceIso = since.toISOString();

  // 并行拉取所有需要的数据
  const [itemsRes, notesCountRes, pinnedRes, itemTagsRes, noteTagsRes] = await Promise.all([
    supabase
      .from("reading_items")
      .select("reading_status, reading_progress, created_at, updated_at, url")
      .eq("user_id", user.id),
    supabase.from("notes").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("reading_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_pinned", true),
    supabase.from("item_tags").select("tag_id"),
    supabase.from("note_tags").select("tag_id"),
  ]);

  if (itemsRes.error) return serverError(itemsRes.error);

  const items = itemsRes.data || [];

  // --- 总数分布 ---
  const totals = {
    items: items.length,
    notes: notesCountRes.count || 0,
    unread: items.filter((i) => i.reading_status === "unread").length,
    reading: items.filter((i) => i.reading_status === "reading").length,
    read: items.filter((i) => i.reading_status === "read").length,
    pinned: pinnedRes.count || 0,
  };

  // --- 平均进度 ---
  const averageProgress =
    items.length === 0
      ? 0
      : items.reduce((sum, i) => sum + (i.reading_progress || 0), 0) / items.length;

  // --- 每日新增文章（按本地日期 YYYY-MM-DD 分桶）---
  const dailyMap = new Map<string, number>();
  const readMap = new Map<string, number>();
  // 初始化空桶（让图表 X 轴连续）
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyMap.set(formatDate(d), 0);
    readMap.set(formatDate(d), 0);
  }
  for (const item of items) {
    const createdDate = formatDate(new Date(item.created_at));
    if (dailyMap.has(createdDate)) {
      dailyMap.set(createdDate, (dailyMap.get(createdDate) || 0) + 1);
    }
    if (item.reading_status === "read" && item.updated_at) {
      const updatedDate = formatDate(new Date(item.updated_at));
      if (new Date(item.updated_at) >= since && readMap.has(updatedDate)) {
        readMap.set(updatedDate, (readMap.get(updatedDate) || 0) + 1);
      }
    }
  }
  const dailyItems = Array.from(dailyMap, ([date, count]) => ({ date, count }));
  const dailyRead = Array.from(readMap, ([date, count]) => ({ date, count }));

  // --- Top 标签（合并两类使用计数）---
  const tagUse = new Map<string, number>();
  for (const r of itemTagsRes.data || []) {
    tagUse.set(r.tag_id, (tagUse.get(r.tag_id) || 0) + 1);
  }
  for (const r of noteTagsRes.data || []) {
    tagUse.set(r.tag_id, (tagUse.get(r.tag_id) || 0) + 1);
  }
  // 取所有用过的 tag_id 查名字
  const usedTagIds = Array.from(tagUse.keys());
  let topTags: StatsResponse["topTags"] = [];
  if (usedTagIds.length > 0) {
    const { data: tagRows } = await supabase
      .from("tags")
      .select("id, name")
      .in("id", usedTagIds);
    topTags = (tagRows || [])
      .map((t) => ({ id: t.id, name: t.name, count: tagUse.get(t.id) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  // --- Top 来源（按 URL host）---
  const hostMap = new Map<string, number>();
  for (const item of items) {
    try {
      const host = new URL(item.url).hostname.replace(/^www\./, "");
      hostMap.set(host, (hostMap.get(host) || 0) + 1);
    } catch {
      // 无效 URL 跳过
    }
  }
  const topSources = Array.from(hostMap, ([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const response: StatsResponse = {
    totals,
    averageProgress,
    dailyItems,
    dailyRead,
    topTags,
    topSources,
  };

  return NextResponse.json(response);
}

function formatDate(d: Date): string {
  // YYYY-MM-DD，本地时区
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
