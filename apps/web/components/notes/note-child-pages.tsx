"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { NoteTreeItem } from "@/lib/notes/tree";

interface NoteChildPagesProps {
  noteId: string;
  notes: NoteTreeItem[];
}

export function NoteChildPages({ noteId, notes }: NoteChildPagesProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [creating, setCreating] = useState(false);
  const children = notes.filter((note) => note.parent_note_id === noteId);

  const createChild = async () => {
    setCreating(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: "无标题笔记",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          parent_note_id: noteId,
          icon: null,
          cover_url: null,
          cover_position: 50,
        })
        .select()
        .single();
      if (error || !data) return;
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      router.push(`/notes/${data.id}`);
    } finally {
      setCreating(false);
    }
  };

  if (children.length === 0) {
    return (
      <button
        type="button"
        className="note-create-child"
        onClick={() => void createChild()}
        disabled={creating}
      >
        {creating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        新建子页面
      </button>
    );
  }

  return (
    <section className="note-child-pages">
      <h2>子页面</h2>
      <div>
        {children.map((note) => (
          <Link
            key={note.id}
            href={`/notes/${note.id}`}
            draggable
            onDragStart={(event) => {
              // 拖进笔记正文时给一份干净的链接 HTML，
              // 避免把列表项里的图标/箭头一起带进去
              const url = `/notes/${note.id}`;
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.textContent = `${note.icon || "📄"} ${note.title || "无标题笔记"}`;
              event.dataTransfer.effectAllowed = "copyLink";
              event.dataTransfer.setData("text/uri-list", url);
              event.dataTransfer.setData("text/plain", url);
              event.dataTransfer.setData("text/html", anchor.outerHTML);
            }}
          >
            <span>{note.icon || "📄"}</span>
            <span>{note.title || "无标题笔记"}</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        ))}
        <button
          type="button"
          onClick={() => void createChild()}
          disabled={creating}
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          新建子页面
        </button>
      </div>
    </section>
  );
}
