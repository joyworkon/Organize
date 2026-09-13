"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PluginLoader } from "@/lib/plugin/loader";
import { enablePerfProbe } from "@/lib/perf/probe";

export function PluginBootstrap() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    // B02 性能仪表：longtask / INP 观察器随首个客户端组件启用（幂等）
    enablePerfProbe();
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, [supabase]);
  return userId ? <PluginLoader userId={userId} /> : null;
}
