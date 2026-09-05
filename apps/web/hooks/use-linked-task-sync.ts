"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useRef } from "react";
import { appEvents } from "@/lib/plugin/events";

/**
 * 任务→笔记反向同步（G2，R08 抽离自笔记页）：
 * - 轮询该笔记的 task_item_refs，把任务状态回勾到编辑器里同 taskId 的块。
 * - 回写是系统事务：标 remote-sync、不进 Undo、不激活任务（与手改来源区分）。
 * - 轮询纪律（R08.4）：
 *   · 无引用笔记不产生 3 秒轮询——先探测一次，无引用则不启动；
 *     本笔记保存成功（note:saved 事件）后再探测一次，出现引用才升级为轮询
 *   · 页面不可见时暂停 tick；重新可见 / 窗口聚焦立即同步一次
 *   · 请求不重叠（in-flight 门），上一次未返回不发起下一次
 * 本地 dev 的 Realtime 有 signature_error 已知问题，故用轮询保证 dev/生产一致。
 */
export function useLinkedTaskSync(options: {
  noteId: string;
  /** 双链开关（isTaskNoteLinkEnabled） */
  enabled: boolean;
  /** 编辑器就绪晚于本 effect，动态读取 */
  getEditor: () => Editor | null;
  /** supabase 客户端（由页面注入，保持单一来源） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}): void {
  const { noteId, enabled, getEditor, supabase } = options;
  const hasRefsRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // 把某 task 状态回写到编辑器里所有同 taskId 的 taskItem（checked = status==='done'）
    const applyTaskStatus = (taskId: string, status: string) => {
      const editor = getEditor();
      if (!editor) return;
      const checked = status === "done";
      let changed = false;
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "taskItem" && node.attrs.taskId === taskId && node.attrs.checked !== checked) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
          changed = true;
        }
        return true;
      });
      if (changed) {
        // 系统事务：标 remote-sync，不激活、不进 Undo
        tr.setMeta("transactionSource", "remote-sync");
        tr.setMeta("addToHistory", false);
        editor.view.dispatch(tr);
      }
    };

    const syncFromTasks = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const { data: refs } = await supabase
          .from("task_item_refs")
          .select("task_id, tasks!inner(status)")
          .eq("note_id", noteId);
        if (!refs) return;
        hasRefsRef.current = refs.length > 0;
        for (const ref of refs as Array<{ task_id: string; tasks?: { status?: string } }>) {
          const status = ref.tasks?.status;
          if (status) applyTaskStatus(ref.task_id, status);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    // 轮询 tick：仅在页面可见时执行（后台标签页暂停）
    let timer: ReturnType<typeof setInterval> | null = null;
    const startPollingIfRefs = () => {
      if (!hasRefsRef.current || timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void syncFromTasks();
      }, 3000);
    };

    // 重新可见 / 聚焦：立即同步一次（有引用时）
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (hasRefsRef.current) void syncFromTasks();
    };

    // 本笔记保存成功后再探测：编辑期间新建的任务绑定（refs 从无到有）要能被发现
    const offSaved = appEvents.on("note:saved", (payload) => {
      if (payload.noteId !== noteId) return;
      void syncFromTasks().then(() => startPollingIfRefs());
    });

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    // 初始探测：有引用才启动轮询；无引用的笔记不产生 3 秒轮询
    void syncFromTasks().then(() => startPollingIfRefs());

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      offSaved();
    };
  }, [noteId, enabled, getEditor, supabase]);
}
