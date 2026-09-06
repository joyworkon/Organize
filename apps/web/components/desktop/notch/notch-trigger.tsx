"use client";

/** Native window frame is the exact visible hit region in safe screen coordinates. */
export function NotchTrigger() {
  return <div aria-hidden className="h-screen w-screen rounded-full bg-neutral-700/80 ring-1 ring-inset ring-white/40" />;
}
