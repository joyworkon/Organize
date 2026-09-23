"use client";

// 资料库（阶段 C）：稍后读 + 速记融合后的统一入口。三视图：
//   全部（统一游标列表，双源卡片）/ 稍后读（原阅读库能力）/ 速记（原速记页能力）。
// 统一输入框在页顶三视图共用；旧 /memos、/inbox 重定向兼容（query 透传）。
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageSearch } from "@/components/layout/page-search";
import { UnifiedCapture, type UnifiedCaptureHandle } from "@/components/library/unified-capture";
import { UnifiedView } from "@/components/library/unified-view";
import { ReadingView } from "@/components/library/reading-view";
import { MemosView } from "@/components/library/memos-view";
import { FilesView } from "@/components/library/files-view";
import { FileImport } from "@/components/library/file-import";
import { MaterialImport } from "@/components/reading/material-import";
import { useHotkey, hasOpenDialog } from "@/lib/hooks/use-hotkey";
import { cn } from "@/lib/utils";
import { Library } from "@/components/icons";

type LibraryView = "all" | "reading" | "memos" | "files";

const viewTabs: { value: LibraryView; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "reading", label: "稍后读" },
  { value: "memos", label: "速记" },
  { value: "files", label: "文件" },
];

/** ?view= 归一化：缺省 all；memo 是 memos 的历史别名（旧链接兼容） */
function normalizeView(raw: string | null): LibraryView {
  if (raw === "reading") return "reading";
  if (raw === "memos" || raw === "memo") return "memos";
  if (raw === "files") return "files";
  return "all";
}

export default function LibraryPage() {
  // useSearchParams 需要 Suspense 边界（与 tasks 页同一模式）
  return (
    <Suspense fallback={<div className="grid h-screen place-items-center text-muted-foreground">加载中…</div>}>
      <LibraryPageInner />
    </Suspense>
  );
}

function LibraryPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = normalizeView(searchParams.get("view"));

  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const unifiedRef = useRef<UnifiedCaptureHandle>(null);
  // 统一输入框/物料导入入库后递增，挂载中的视图据此刷新
  const [refreshTick, setRefreshTick] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // 页面统一注册 Esc：先看视图是否消费（稍后读多选退出），否则清空搜索
  const escapeHandlerRef = useRef<(() => boolean) | null>(null);
  const registerEscape = useCallback((handler: (() => boolean) | null) => {
    escapeHandlerRef.current = handler;
  }, []);

  // 页面快捷键：/ 聚焦搜索、Esc 退出多选或清空搜索（弹层打开时让位）
  useHotkey([
    {
      key: "/",
      ctrlKey: false,
      metaKey: false,
      handler: () => { if (!hasOpenDialog()) searchInputRef.current?.focus(); },
    },
    {
      key: "escape",
      ctrlKey: false,
      metaKey: false,
      handler: () => {
        if (hasOpenDialog()) return;
        if (escapeHandlerRef.current?.()) return;
        if (search) setSearch("");
      },
    },
  ]);

  // 速记视图空态的「清空搜索」按钮经事件上抛（search state 在页面层）
  useEffect(() => {
    const clear = () => setSearch("");
    window.addEventListener("organize:page-search-clear", clear);
    return () => window.removeEventListener("organize:page-search-clear", clear);
  }, []);

  // ?compose=1（侧栏资料库行内「+」）：聚焦统一输入框后抹掉参数（保留其他筛选）
  useEffect(() => {
    if (searchParams.get("compose") !== "1") return;
    const timer = setTimeout(() => {
      unifiedRef.current?.focus();
      const params = new URLSearchParams(searchParams.toString());
      params.delete("compose");
      window.history.replaceState(null, "", `${pathname}${params.size ? `?${params}` : ""}`);
    }, 120);
    return () => clearTimeout(timer);
  }, [searchParams, pathname]);

  const setView = (next: LibraryView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("view");
    else params.set("view", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const searchPlaceholder =
    view === "memos"
      ? "搜索速记（正文 / 标签）"
      : view === "reading"
        ? "搜索稍后读（标题 / 标签）"
        : view === "files"
          ? "搜索导入文件"
          : "搜索资料库（标题 / 正文 / 标签）";

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        icon={Library}
        title="资料库"
        search={
          <PageSearch
            ref={searchInputRef}
            value={search}
            onChange={setSearch}
            placeholder={searchPlaceholder}
          />
        }
      />

      <UnifiedCapture ref={unifiedRef} onCaptured={bumpRefresh} />

      {/* 文件导入面板（阶段 D）：三视图共用；统一输入框拖入的文件也交给它
          （organize:import-files 事件） */}
      <FileImport onImported={bumpRefresh} />

      {/* 视图分段：全部 / 稍后读 / 速记（?view= 双向同步，默认 all） */}
      <div className="reading-status-tabs flex gap-1 rounded-lg bg-muted p-1 w-fit" role="tablist" aria-label="资料库视图">
        {viewTabs.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={view === tab.value}
            onClick={() => setView(tab.value)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              view === tab.value
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === "all" ? (
        <UnifiedView search={search} refreshTick={refreshTick} />
      ) : view === "reading" ? (
        <>
          {/* AI 物料整理（可选）：不保存原件，生成派生整理稿；文件导入走上方导入面板 */}
          <MaterialImport onAdded={bumpRefresh} />
          <ReadingView search={search} refreshTick={refreshTick} registerEscape={registerEscape} />
        </>
      ) : view === "files" ? (
        <FilesView refreshTick={refreshTick} onImported={bumpRefresh} />
      ) : (
        <MemosView search={search} />
      )}
    </div>
  );
}
