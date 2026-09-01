import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileBottomBar } from "@/components/layout/mobile-bottom-bar";
import { GlobalHotkeys } from "@/components/layout/global-hotkeys";
import { PluginBootstrap } from "@/components/plugin/plugin-bootstrap";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui/toast";
import { QuickAdd } from "@/components/quick-add";
import { Onboarding } from "@/components/onboarding";
import { PromptHost } from "@/components/ui/prompt-dialog";
import { BodyPointerEventsGuard } from "@/components/layout/pointer-events-guard";
import { QuickSaveBridge } from "@/components/desktop/quick-save";
import { NavigateBridge } from "@/components/desktop/navigate-bridge";
import { ShareBridge } from "@/components/mobile/share-bridge";
import { NoteTabsBar } from "@/components/notes/note-tabs-bar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <BodyPointerEventsGuard />
      <PluginBootstrap />
      <Suspense fallback={null}>
        <Sidebar />
      </Suspense>
      <MobileBottomBar />
      <GlobalHotkeys />
      <CommandPalette />
      <Toaster />
      <main className="organize-sidebar-offset pt-14 transition-[padding] duration-200 md:pt-0 pb-16 md:pb-0">
        {/* 桌面端 Chrome 式笔记标签页条：吸顶，笔记页顶栏在其下方吸顶（见 globals.css 偏移） */}
        <NoteTabsBar />
        <div className="p-4 md:p-6">{children}</div>
      </main>
      <QuickAdd />
      <ShareBridge />
      <QuickSaveBridge />
      <NavigateBridge />
      <Onboarding />
      <PromptHost />
    </div>
  );
}
