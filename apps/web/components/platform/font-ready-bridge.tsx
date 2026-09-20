"use client";

import { useEffect } from "react";

/**
 * Announces the final interface metrics after self-hosted MiSans has loaded.
 * Layout engines such as the idea canvas can invalidate text measurements on
 * this event without coupling the global shell to their document model.
 */
export function FontReadyBridge() {
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      document.documentElement.dataset.fontsReady = "true";
      window.dispatchEvent(new CustomEvent("organize:fonts-ready"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
