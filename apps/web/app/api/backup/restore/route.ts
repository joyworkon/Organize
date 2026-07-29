import { NextRequest, NextResponse } from "next/server";
import { inspectBackupV2, BACKUP_MAX_BYTES } from "@/lib/backup/schema";
import { prepareRestorePayload } from "@/lib/backup/restore";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface RestoreRpcResult {
  status?: unknown;
  counts?: unknown;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "未授权", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > BACKUP_MAX_BYTES) {
    return NextResponse.json(
      { error: "备份文件过大", code: "BACKUP_TOO_LARGE" },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "备份不是有效 JSON", code: "INVALID_BACKUP" },
      { status: 400 }
    );
  }

  const inspection = inspectBackupV2(body);
  if (!inspection.ok) {
    return NextResponse.json(
      {
        error: "备份校验失败",
        code: "INVALID_BACKUP",
        issues: inspection.issues.slice(0, 50),
      },
      { status: 400 }
    );
  }

  let payload;
  try {
    payload = prepareRestorePayload(inspection.backup);
  } catch (error) {
    console.error("Failed to prepare restore payload:", error);
    return NextResponse.json(
      { error: "备份关系无法重建", code: "INVALID_BACKUP" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("restore_backup_v2", {
    p_payload: payload,
  });
  if (error) {
    console.error("Atomic backup restore failed:", error.message);
    return NextResponse.json(
      { error: "恢复失败，未写入任何数据", code: "RESTORE_FAILED" },
      { status: 422 }
    );
  }

  const result = data as RestoreRpcResult | null;
  if (result?.status === "not_empty") {
    return NextResponse.json(
      { error: "只允许恢复到空账户", code: "ACCOUNT_NOT_EMPTY" },
      { status: 409 }
    );
  }
  if (result?.status !== "restored") {
    return NextResponse.json(
      { error: "恢复结果无效", code: "RESTORE_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, counts: result.counts });
}
