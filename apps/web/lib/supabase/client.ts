import { createBrowserClient } from "@supabase/ssr";
import { createMockClient } from "./mock-client";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient(): ReturnType<typeof createBrowserClient> {
  if (browserClient) return browserClient;

  // 开发假后端模式：无 Supabase 时用内存数据驱动 UI（见 .env.local 的 NEXT_PUBLIC_MOCK_BACKEND）
  if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
    browserClient = createMockClient() as ReturnType<typeof createBrowserClient>;
  } else {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browserClient;
}
