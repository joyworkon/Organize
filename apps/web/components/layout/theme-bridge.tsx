"use client";

import { useThemeMode } from "@/hooks/use-theme-mode";
import { useThemeColor } from "@/hooks/use-theme-color";

/** Theme preferences also apply to auth, public shares and standalone routes. */
export function ThemeBridge() {
  useThemeMode();
  useThemeColor();
  return null;
}
