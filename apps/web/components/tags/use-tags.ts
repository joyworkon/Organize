"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tag, TagWithCount } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";

type TaggableResource = "note" | "reading_item";

// "reading_item" 在 URL 里用 reading-items
const RESOURCE_ENDPOINT: Record<TaggableResource, string> = {
  note: "/api/notes",
  reading_item: "/api/reading-items",
};

// mock 后端（NEXT_PUBLIC_MOCK_BACKEND=true）没有 /api/* 实现，标签读写直接走浏览器内存
// mock client，与 tags 页等直连 client 的视图共享同一份 mockDb；真实后端仍走 API 路由。
const MOCK_BACKEND = process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";

const RESOURCE_LINK_TABLE: Record<TaggableResource, { link: string; foreignKey: string }> = {
  note: { link: "note_tags", foreignKey: "note_id" },
  reading_item: { link: "item_tags", foreignKey: "item_id" },
};

// TagSelector 用 new: 前缀标记"待创建"的临时 id，hook 乐观更新内部用 temp: 前缀
function isTemporaryTagId(id: string | undefined): boolean {
  return !!id && (id.startsWith("new:") || id.startsWith("temp:"));
}

const ZERO_COUNTS = { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };

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
      if (MOCK_BACKEND) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: tagData } = await supabase
          .from("tags")
          .select("id, name, color")
          .eq("user_id", user.id)
          .order("name", { ascending: true });
        const [itemRes, noteRes, taskRes, lessonRes] = await Promise.all([
          supabase.from("item_tags").select("tag_id"),
          supabase.from("note_tags").select("tag_id"),
          supabase.from("task_tags").select("tag_id"),
          supabase.from("lesson_tags").select("tag_id"),
        ]);

        const countMap = new Map<string, typeof ZERO_COUNTS>();
        const bump = (tagId: string, key: keyof typeof ZERO_COUNTS) => {
          const entry = countMap.get(tagId) || { ...ZERO_COUNTS };
          entry[key] += 1;
          countMap.set(tagId, entry);
        };
        for (const row of itemRes.data || []) bump(row.tag_id, "reading_item_count");
        for (const row of noteRes.data || []) bump(row.tag_id, "note_count");
        for (const row of taskRes.data || []) bump(row.tag_id, "task_count");
        for (const row of lessonRes.data || []) bump(row.tag_id, "lesson_count");

        setTags(
          (tagData || []).map((t) => ({
            ...t,
            user_id: user.id,
            ...(countMap.get(t.id) || ZERO_COUNTS),
          }))
        );
        return;
      }

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
  const linkTable = RESOURCE_LINK_TABLE[resource].link;
  const foreignKey = RESOURCE_LINK_TABLE[resource].foreignKey;

  const refresh = useCallback(async () => {
    if (!resourceId) {
      setTags([]);
      return;
    }
    setLoading(true);
    try {
      if (MOCK_BACKEND) {
        const supabase = createClient();
        const { data: links } = await supabase
          .from(linkTable)
          .select("tag_id")
          .eq(foreignKey, resourceId);
        const tagIds = (links || []).map((row) => row.tag_id);
        if (tagIds.length === 0) {
          setTags([]);
          return;
        }
        // mock 查询构造器不支持嵌入 select，分两步：关联表 → 按 id 取标签
        const { data: tagRows } = await supabase
          .from("tags")
          .select("id, name, color")
          .in("id", tagIds);
        setTags((tagRows || []) as Tag[]);
        return;
      }

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
  }, [base, foreignKey, linkTable, resourceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // mock 模式：确保标签存在（按 name upsert），并把关联写入 link 表，返回真实 tag id
  const mockResolveAndLink = useCallback(
    async (tag: { id?: string; name?: string }): Promise<string | undefined> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return undefined;

      let tagId = !isTemporaryTagId(tag.id) ? tag.id : undefined;
      if (!tagId && tag.name) {
        const { data: upserted, error } = await supabase
          .from("tags")
          .upsert({ user_id: user.id, name: tag.name }, { onConflict: "user_id,name" })
          .select("id")
          .single();
        if (error || !upserted?.id) return undefined;
        tagId = upserted.id;
      }
      if (!tagId) return undefined;

      // 幂等：已有关联不重复插入（mock 无 unique 约束兜底）
      const { data: existing } = await supabase
        .from(linkTable)
        .select("tag_id")
        .eq(foreignKey, resourceId)
        .eq("tag_id", tagId);
      if (existing && existing.length > 0) return tagId;

      const { error: linkError } = await supabase
        .from(linkTable)
        .insert({ user_id: user.id, [foreignKey]: resourceId, tag_id: tagId });
      if (linkError) return undefined;
      return tagId;
    },
    [foreignKey, linkTable, resourceId]
  );

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
        if (MOCK_BACKEND) {
          const tagId = await mockResolveAndLink(tag);
          if (!tagId) {
            setTags((prev) => prev.filter((t) => t.id !== optimistic.id));
            return;
          }
          // 用真实 id 替换临时 id
          setTags((prev) =>
            prev.map((t) => (t.id === optimistic.id ? { ...t, id: tagId } : t))
          );
          return tagId;
        }

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
    [base, mockResolveAndLink, resourceId]
  );

  const removeTag = useCallback(
    async (tagId: string) => {
      if (!resourceId) return;
      const snapshot = tags;
      setTags((cur) => cur.filter((t) => t.id !== tagId));
      try {
        if (MOCK_BACKEND) {
          const supabase = createClient();
          await supabase
            .from(linkTable)
            .delete()
            .eq(foreignKey, resourceId)
            .eq("tag_id", tagId);
          return;
        }
        await fetch(`${base}/${resourceId}/tags?tag_id=${tagId}`, { method: "DELETE" });
      } catch {
        setTags(snapshot);
      }
    },
    [base, foreignKey, linkTable, resourceId, tags]
  );

  return { tags, loading, refresh, addTag, removeTag };
}
