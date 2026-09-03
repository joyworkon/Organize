import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import {
  DUE_SOON_WINDOW_MINUTES,
  buildDueSoonFilter,
  toDueSoonTasks,
} from "@/lib/tasks/due-soon";

// GET /api/tasks/due-soon - 当前用户未来 15 分钟内到期/开始的未完成任务
// （用户态请求走 RLS；桌面壳提醒轮询的兜底数据源，multi-platform-plan §3.2）
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const now = new Date();
  const windowEnd = new Date(now.getTime() + DUE_SOON_WINDOW_MINUTES * 60_000);

  const { data, error } = await supabase
    .from("tasks")
    .select("id,title,schedule_start_at,schedule_end_at")
    // 未完成任务：done/cancelled 不提醒；软删除行由 RLS/过滤排除
    .not("status", "in", "(done,cancelled)")
    .is("deleted_at", null)
    .or(buildDueSoonFilter(now, windowEnd));

  if (error) return serverError(error);
  return NextResponse.json(toDueSoonTasks(data ?? [], now, windowEnd));
}
