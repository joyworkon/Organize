// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNoteSaveSession } from "./use-note-session";
import type { NoteDraftSnapshot } from "@/lib/notes/local-draft";
import type { NoteSaveTransport } from "@/lib/notes/note-save-session";

const makeDraft = (title: string): NoteDraftSnapshot => ({ title, content: { type: "doc", content: [{ type: "paragraph" }] }, icon: null, cover_url: null, cover_position: 50, parent_note_id: null, full_width: false, font_family: "default", small_font: false });
const transport = (): NoteSaveTransport => ({ save: vi.fn(async () => ({ data: { status: "ok", note_revision: 1 }, error: null })), fetchRemoteDraft: vi.fn(async () => null), fetchProfileName: vi.fn(async () => null), findPendingCreate: vi.fn(() => null), removePendingCreate: vi.fn(), insertPendingCreate: vi.fn(async () => ({ error: null })) });

describe("useNoteSaveSession identity", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let current: ReturnType<typeof useNoteSaveSession>;
  const draftRef = { current: makeDraft("A") };
  function Harness({ noteId, accountId, channel, onSaved }: { noteId: string; accountId: string | null; channel: NoteSaveTransport; onSaved: () => void }) {
    current = useNoteSaveSession({ noteId, accountId, draftRef, getRole: () => "owner", isCollabActive: () => false, isOnline: () => true, isTaskNoteLinkEnabled: () => false, createTransport: () => channel, consumeSkipFlush: () => false, onSaved });
    return <span>{current.ui?.phase ?? "unavailable"}</span>;
  }
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    draftRef.current = makeDraft("A");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("late A response never invokes B callback or changes B save state", async () => {
    const a = transport();
    const b = transport();
    const onSavedA = vi.fn();
    const onSavedB = vi.fn();
    let resolveA!: (value: Awaited<ReturnType<NoteSaveTransport["save"]>>) => void;
    vi.mocked(a.save).mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    await act(async () => root.render(<Harness noteId="A" accountId="user-1" channel={a} onSaved={onSavedA} />));
    const first = current.session!;
    let inFlight!: ReturnType<typeof first.flush>;
    act(() => { first.patchDraft({ title: "unsynced A" }); inFlight = first.flush(); });
    draftRef.current = makeDraft("B");
    await act(async () => root.render(<Harness noteId="B" accountId="user-1" channel={b} onSaved={onSavedB} />));
    const second = current.session!;
    expect(second.noteId).toBe("B");
    await act(async () => { resolveA({ data: { status: "ok", note_revision: 8 }, error: null }); await inFlight; });
    expect(onSavedA).not.toHaveBeenCalled();
    expect(onSavedB).not.toHaveBeenCalled();
    expect(current.session).toBe(second);
    expect(current.ui?.lastSavedAt).toBeNull();
    expect(current.ui?.phase).toBe("clean");
  });

  it("same identity preserves the live save session; logout exposes no old state", async () => {
    const channel = transport();
    const onSaved = vi.fn();
    await act(async () => root.render(<Harness noteId="A" accountId="user-1" channel={channel} onSaved={onSaved} />));
    const first = current.session!;
    await act(async () => { first.patchDraft({ title: "saved A" }); await first.flush(); });
    expect(current.ui?.lastSavedAt).not.toBeNull();
    await act(async () => root.render(<Harness noteId="A" accountId="user-1" channel={channel} onSaved={onSaved} />));
    expect(current.session).toBe(first);
    await act(async () => root.render(<Harness noteId="A" accountId={null} channel={channel} onSaved={onSaved} />));
    expect(current.session).toBeNull();
    expect(current.ui).toBeNull();
  });
});
