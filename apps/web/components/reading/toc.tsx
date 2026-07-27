"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { List } from "lucide-react";

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\w\s\u4e00-\u9fa5-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function extractHeadings(html: string): Heading[] {
  const headings: Heading[] = [];
  const idCount = new Map<string, number>();

  const regex = /<(h[123])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const innerHtml = match[2];

    const level = tagName === "h1" ? 2 : tagName === "h2" ? 2 : 3;

    const text = innerHtml
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();

    if (!text) continue;

    let id = slugify(text);
    if (!id) {
      id = `heading-${headings.length + 1}`;
    }

    if (idCount.has(id)) {
      const count = idCount.get(id)! + 1;
      idCount.set(id, count);
      id = `${id}-${count}`;
    } else {
      idCount.set(id, 1);
    }

    headings.push({ id, text, level: level as 2 | 3 });
  }

  return headings;
}

interface TocProps {
  headings: Heading[];
  containerRef: React.RefObject<HTMLDivElement>;
}

export function Toc({ headings, containerRef }: TocProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const headingElements = containerRef.current.querySelectorAll("h2, h3");
    headingElements.forEach((el, index) => {
      if (headings[index]) {
        el.id = headings[index].id;
      }
    });

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((entry) => entry.isIntersecting);
        if (visibleEntries.length > 0) {
          visibleEntries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          setActiveId(visibleEntries[0].target.id);
        }
      },
      {
        rootMargin: "-80px 0px -70% 0px",
        threshold: 0,
      }
    );

    headingElements.forEach((el) => observer.observe(el));

    return () => {
      headingElements.forEach((el) => observer.unobserve(el));
    };
  }, [headings, containerRef]);

  const handleClick = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setIsDrawerOpen(false);
    }
  }, []);

  if (headings.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setIsDrawerOpen(true)}
        className="xl:hidden fixed bottom-20 right-4 z-20 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
      >
        <List className="h-4 w-4" />
        目录
      </button>

      <nav
        className={cn(
          "hidden xl:block fixed top-20 right-8 z-10",
          "w-56 max-w-56 max-h-[calc(100vh-6rem)] overflow-y-auto",
          "bg-background/95 backdrop-blur",
          "border rounded-lg p-4"
        )}
      >
        <h4 className="mb-3 text-sm font-semibold text-foreground">目录</h4>
        <ul className="space-y-1">
          {headings.map((heading) => (
            <li key={heading.id}>
              <button
                onClick={() => handleClick(heading.id)}
                className={cn(
                  "w-full text-left text-sm py-1.5 px-2 rounded transition-colors block",
                  "hover:text-foreground",
                  heading.level === 3 && "pl-5",
                  activeId === heading.id
                    ? "text-primary font-medium bg-primary/5"
                    : "text-muted-foreground"
                )}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div
        className={cn(
          "xl:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          isDrawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsDrawerOpen(false)}
      />
      <div
        className={cn(
          "xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t",
          "rounded-t-xl transition-transform duration-300 ease-out",
          "max-h-[60vh] overflow-y-auto",
          isDrawerOpen ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="sticky top-0 bg-background border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">目录</h4>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="text-muted-foreground hover:text-foreground text-sm p-1"
            >
              关闭
            </button>
          </div>
        </div>
        <ul className="p-4 space-y-1">
          {headings.map((heading) => (
            <li key={heading.id}>
              <button
                onClick={() => handleClick(heading.id)}
                className={cn(
                  "w-full text-left text-sm py-2 px-2 rounded transition-colors block",
                  "hover:text-foreground",
                  heading.level === 3 && "pl-5",
                  activeId === heading.id
                    ? "text-primary font-medium bg-primary/5"
                    : "text-muted-foreground"
                )}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
