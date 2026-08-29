import { createBrowserClient } from "@supabase/ssr";
import { createMockClient } from "./mock-client";
import { installMockApiShim } from "@/lib/mock/api-shim";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

// mock 模式下同步安装 /api/* 拦截层（模块加载期，先于任何组件 effect 发起的 fetch）
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
  installMockApiShim();
}

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
