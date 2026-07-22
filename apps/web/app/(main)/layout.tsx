import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { GlobalHotkeys } from "@/components/layout/global-hotkeys";
import { PluginBootstrap } from "@/components/plugin/plugin-bootstrap";

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
      <main className="md:pl-60 pt-14 md:pt-0 pb-16 md:pb-0">
        <div className="container mx-auto p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
