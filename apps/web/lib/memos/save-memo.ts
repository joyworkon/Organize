/**
 * 速记统一提交链路（阶段 C 从 memos 页抽出，与资料库统一输入框共用）：
 * 客户端稳定 id + 服务端幂等合同 + 断网离线队列，行为与原 memos 页 handleSave 一致。
 *
 * - 显式 uuid id：重复提交/离线回放由服务端主键去重（POST /api/memos 冲突返回既有行）
 * - 网络类失败与断网 → enqueueMemoCreate 入队乐观上屏，联网后回放
 * - 业务错误（超长等）→ error，调用方保留输入现场
 */
import type { Memo } from "@organize/shared";
import { parseMemoTags } from "./tags";
import { enqueueMemoCreate } from "@/lib/offline/memo-queue";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { isOnline } from "@/lib/offline/network";

export const MEMO_MAX_LENGTH = 5000;

export interface SubmitMemoInput {
  content: string;
  userId: string | null;
  /** 调用方指定稳定 id（测试/幂等重试）；缺省 crypto.randomUUID() */
  memoId?: string;
}

export type SubmitMemoResult =
  | { status: "saved"; memo: Memo; clientId: string }
  | { status: "queued"; memo: Memo; persisted: boolean; clientId: string }
  | { status: "error"; message: string };

export function buildOptimisticMemo(content: string, userId: string | null, memoId: string, now = new Date()): Memo {
  return {
    id: memoId,
    user_id: userId ?? "",
    content,
    tags: parseMemoTags(content),
    deleted_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  } as Memo;
}

export async function submitMemo(input: SubmitMemoInput): Promise<SubmitMemoResult> {
  const content = input.content.trim();
  if (!content) return { status: "error", message: "内容为空" };
  if (content.length > MEMO_MAX_LENGTH) {
    return { status: "error", message: `速记最多 ${MEMO_MAX_LENGTH} 字，当前 ${content.length} 字` };
  }
  const memoId = input.memoId ?? crypto.randomUUID();
  const optimistic = buildOptimisticMemo(content, input.userId, memoId);

  const queueOffline = (): SubmitMemoResult => {
    const { persisted } = enqueueMemoCreate(localStorage, input.userId ?? "", {
      op_id: crypto.randomUUID(),
      memo: { id: memoId, content },
      created_at: Date.now(),
    });
    return { status: "queued", memo: optimistic, persisted, clientId: memoId };
  };

  if (!isOnline()) return queueOffline();

  try {
    const res = await fetch("/api/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, id: memoId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const error = new Error(data?.error || "保存失败");
      // 网络类失败与断网同样入队回放；业务错误（如超长）保留输入现场
      if (isNetworkSaveError(error) || res.status >= 500) return queueOffline();
      return { status: "error", message: error.message };
    }
    const memo = (await res.json()) as Memo;
    return { status: "saved", memo, clientId: memoId };
  } catch (error) {
    if (isNetworkSaveError(error)) return queueOffline();
    return {
      status: "error",
      message: error instanceof Error ? error.message : "保存失败",
    };
  }
}
