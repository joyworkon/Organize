"use client";

import { cn } from "@/lib/utils";
import type { TagColor } from "@organize/shared";

const COLOR_DOT_CLASSES: Record<TagColor, string> = {
  gray: "bg-gray-400 dark:bg-gray-500",
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  yellow: "bg-yellow-400 dark:bg-yellow-400",
  green: "bg-green-500 dark:bg-green-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  cyan: "bg-cyan-500 dark:bg-cyan-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  indigo: "bg-indigo-500 dark:bg-indigo-400",
  violet: "bg-violet-500 dark:bg-violet-400",
  purple: "bg-purple-500 dark:bg-purple-400",
  fuchsia: "bg-fuchsia-500 dark:bg-fuchsia-400",
  pink: "bg-pink-500 dark:bg-pink-400",
  rose: "bg-rose-500 dark:bg-rose-400",
};

const TAG_COLORS: TagColor[] = [
  "gray", "red", "orange", "amber", "yellow", "green", 
  "emerald", "teal", "cyan", "blue", "indigo", "violet", 
  "purple", "fuchsia", "pink", "rose"
];

interface TagColorPickerProps {
  value: string;
  onChange: (color: TagColor) => void;
}

export function TagColorPicker({ value, onChange }: TagColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            "w-6 h-6 rounded-full border border-border transition-all",
            COLOR_DOT_CLASSES[color],
            value === color 
              ? "ring-2 ring-offset-2 ring-primary scale-110" 
              : "hover:scale-105"
          )}
          aria-label={`选择${color}颜色`}
        />
      ))}
    </div>
  );
}

export { TAG_COLORS, COLOR_DOT_CLASSES };
