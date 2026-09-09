"use client";

import Link from "next/link";
import { BookOpen, Feather, FileText, House, ListChecks } from "lucide-react";
import { MOBILE_DESTINATIONS } from "@/lib/navigation/mobile";
import type { MobileLocations, MobileSection } from "@/lib/navigation/mobile";
import { cn } from "@/lib/utils";

const icons = { home: House, library: BookOpen, notes: FileText, tasks: ListChecks, memos: Feather };

export function MobileBottomBar({ active, locations }: { active: MobileSection | null; locations: MobileLocations }) {
  return (
    <nav className="mobile-tab-bar" aria-label="移动端主导航">
      {MOBILE_DESTINATIONS.map(({ key, label, href }) => {
        const Icon = icons[key];
        const selected = active === key;
        return (
          <Link key={key} href={locations[key] || href} aria-current={selected ? "page" : undefined} className={cn("mobile-tab", selected && "is-active")}>
            <span className="mobile-tab-icon"><Icon className="h-[21px] w-[21px]" strokeWidth={selected ? 2.2 : 1.7} /></span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
