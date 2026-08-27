import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { GlobalHotkeys } from "@/components/layout/global-hotkeys";
import { PluginBootstrap } from "@/components/plugin/plugin-bootstrap";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui/toast";
import { QuickAdd } from "@/components/quick-add";
import { Onboarding } from "@/components/onboarding";
import { PromptHost } from "@/components/ui/prompt-dialog";
import { BodyPointerEventsGuard } from "@/components/layout/pointer-events-guard";
import { QuickSaveBridge } from "@/components/desktop/quick-save";

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
      <MobileTabBar />
      <GlobalHotkeys />
      <CommandPalette />
      <Toaster />
      <main className="organize-sidebar-offset pt-14 transition-[padding] duration-200 md:pt-0 pb-16 md:pb-0">
        <div className="container mx-auto p-4 md:p-6">{children}</div>
      </main>
      <QuickAdd />
      <QuickSaveBridge />
      <Onboarding />
      <PromptHost />
    </div>
  );
}
