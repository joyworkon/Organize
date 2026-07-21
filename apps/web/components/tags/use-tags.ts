"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tag, TagWithCount } from "@organize/shared";

type TaggableResource = "note" | "reading_item";

// "reading_item" 在 URL 里用 reading-items
const RESOURCE_ENDPOINT: Record<TaggableResource, string> = {
  note: "/api/notes",
  reading_item: "/api/reading-items",
};

export { RESOURCE_ENDPOINT };

/**
 * 加载当前用户的全部标签（带使用计数），用于筛选器、选择器下拉。
 * 刷新由父组件控制（通过返回的 refresh 方法）。
 */
export function useAllTags() {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tags", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setTags(data as TagWithCount[]);
      }
    } catch {
      // 静默失败：标签不可用不应阻塞主流程
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tags, loading, refresh, setTags };
}

/**
 * 加载并管理单个资源（note 或 reading_item）的标签。
 * 提供 add/remove 乐观更新方法。
 */
export function useResourceTags(resource: TaggableResource, resourceId: string | null) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);

  const base = RESOURCE_ENDPOINT[resource];

  const refresh = useCallback(async () => {
    if (!resourceId) {
      setTags([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${base}/${resourceId}/tags`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setTags(data as Tag[]);
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, [base, resourceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addTag = useCallback(
    async (tag: { id?: string; name?: string }) => {
      if (!resourceId) return;
      // 乐观更新：先加到本地（若只给了 name 而没有 id，用临时 id）
      const optimistic: Tag = {
        id: tag.id || `temp:${tag.name}`,
        user_id: "",
        name: tag.name || "",
      };
      if (tag.id) {
        setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, optimistic]));
      } else if (tag.name) {
        setTags((prev) => (prev.some((t) => t.name === tag.name) ? prev : [...prev, optimistic]));
      }

      try {
        const res = await fetch(`${base}/${resourceId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tag.id ? { tag_id: tag.id } : { name: tag.name }),
        });
        if (res.ok) {
          const data = await res.json();
          // 用真实 id 替换临时 id
          if (data?.tag_id) {
            setTags((prev) =>
              prev.map((t) => (t.id === optimistic.id ? { ...t, id: data.tag_id } : t))
            );
          }
          return data?.tag_id as string | undefined;
        }
      } catch {
        // 失败回滚
        setTags((prev) => prev.filter((t) => t.id !== optimistic.id));
      }
    },
    [base, resourceId]
  );

  const removeTag = useCallback(
    async (tagId: string) => {
      if (!resourceId) return;
      const snapshot = tags;
      setTags((cur) => cur.filter((t) => t.id !== tagId));
      try {
        await fetch(`${base}/${resourceId}/tags?tag_id=${tagId}`, { method: "DELETE" });
      } catch {
        setTags(snapshot);
      }
    },
    [base, resourceId, tags]
  );

  return { tags, loading, refresh, addTag, removeTag };
}
