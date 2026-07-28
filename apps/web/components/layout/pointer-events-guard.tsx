"use client";

import { useEffect } from "react";

export function BodyPointerEventsGuard() {
  useEffect(() => {
    function restore() {
      if (document.body.style.pointerEvents === "none") {
        const anyModalOpen = document.querySelector("[role='dialog'][data-state='open']");
        if (!anyModalOpen) {
          document.body.style.pointerEvents = "";
        }
      }
    }

    restore();
    const timer = setInterval(restore, 1000);

    const observer = new MutationObserver(() => {
      requestAnimationFrame(restore);
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: false,
    });

    document.addEventListener("click", restore, true);

    return () => {
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener("click", restore, true);
    };
  }, []);

  return null;
}
