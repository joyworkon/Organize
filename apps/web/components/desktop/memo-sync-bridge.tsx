"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { replayMemoCreates } from "@/lib/offline/memo-queue";
import { isOnline, onNetworkChange } from "@/lib/offline/network";

/**
 * The memo queue must be replayed by the app shell, not by whichever route is
 * currently mounted. This matters for the notch panel: it has its own WebView
 * and can be the only visible capture surface.
 */
export function MemoSyncBridge() {
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const client = (clientRef.current ??= createClient());
    let disposed = false;
    let activeUserId: string | null = null;

    const replay = async (userId: string) => {
      if (disposed || !isOnline() || activeUserId !== userId) return;
      const result = await replayMemoCreates(
        {
          createMemo: async (memo) => {
            const response = await fetch("/api/memos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...memo, expected_user_id: userId }),
            });
            if (response.status >= 500) throw new TypeError("Failed to fetch");
            return { ok: response.ok };
          },
        },
        userId,
        localStorage,
      );
      if (!disposed && activeUserId === userId && result.applied > 0) {
        window.dispatchEvent(new Event("organize:memos-synced"));
      }
    };

    const refreshUser = async () => {
      const generation = ++generationRef.current;
      const { data: { session } } = await client.auth.getSession();
      if (disposed || generation !== generationRef.current) return;
      activeUserId = session?.user.id ?? null;
      if (activeUserId) void replay(activeUserId);
    };

    void refreshUser();
    const offNetwork = onNetworkChange((online) => {
      if (online && activeUserId) void replay(activeUserId);
    });
    const { data: { subscription } } = client.auth.onAuthStateChange(() => {
      void refreshUser();
    });

    return () => {
      disposed = true;
      generationRef.current += 1;
      activeUserId = null;
      offNetwork();
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
