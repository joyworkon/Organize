"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { applyThemeColor, getThemeColor, type ThemeColor } from "@/hooks/use-theme-color";

const COLOR_DOT_CLASSES: Record<ThemeColor, string> = {
  orange: "bg-orange-500 dark:bg-orange-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  green: "bg-green-500 dark:bg-green-400",
  purple: "bg-purple-500 dark:bg-purple-400",
  pink: "bg-pink-500 dark:bg-pink-400",
};

const THEME_COLOR_LIST: ThemeColor[] = ["orange", "blue", "green", "purple", "pink"];

interface ThemeColorPickerProps {
  compact?: boolean;
}

export function ThemeColorPicker({ compact = false }: ThemeColorPickerProps) {
  const [selected, setSelected] = useState<ThemeColor>("orange");

  useEffect(() => {
    setSelected(getThemeColor());
  }, []);

  const handleSelect = (color: ThemeColor) => {
    setSelected(color);
    applyThemeColor(color);
  };

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        {THEME_COLOR_LIST.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => handleSelect(color)}
            className={cn(
              "w-3.5 h-3.5 rounded-full border border-border/60 transition-all",
              COLOR_DOT_CLASSES[color],
              selected === color
                ? "ring-2 ring-offset-1 ring-primary scale-110"
                : "hover:scale-110"
            )}
            aria-label={`选择${color}主题色`}
            title={`${color}主题`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-1 py-1.5">
      {THEME_COLOR_LIST.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => handleSelect(color)}
          className={cn(
            "w-6 h-6 rounded-full border border-border transition-all",
            COLOR_DOT_CLASSES[color],
            selected === color
              ? "ring-2 ring-offset-2 ring-primary scale-110"
              : "hover:scale-105"
          )}
          aria-label={`选择${color}主题色`}
          title={`${color}主题`}
        />
      ))}
    </div>
  );
}
