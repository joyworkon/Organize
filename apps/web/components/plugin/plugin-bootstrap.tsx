"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PluginLoader } from "@/lib/plugin/loader";

export function PluginBootstrap() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, [supabase]);
  return userId ? <PluginLoader userId={userId} /> : null;
}
