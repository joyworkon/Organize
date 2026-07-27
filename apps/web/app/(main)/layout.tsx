import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { GlobalHotkeys } from "@/components/layout/global-hotkeys";
import { PluginBootstrap } from "@/components/plugin/plugin-bootstrap";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui/toast";
import { QuickAdd } from "@/components/quick-add";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <PluginBootstrap />
      <Sidebar />
      <MobileTabBar />
      <GlobalHotkeys />
      <CommandPalette />
      <Toaster />
      <main className="organize-sidebar-offset pt-14 transition-[padding] duration-200 md:pt-0 pb-16 md:pb-0">
        <div className="container mx-auto p-4 md:p-6">{children}</div>
      </main>
      <QuickAdd />
    </div>
  );
}
