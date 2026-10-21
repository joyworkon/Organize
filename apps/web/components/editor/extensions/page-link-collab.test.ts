// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Link from "@tiptap/extension-link";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { buildEditorExtensions } from "../editor-extensions";
import { expect, it, vi } from "vitest";
import { resolveTransactionSource } from "@/lib/collab/transaction-source";
import { insertPageLink } from "./page-link-trigger";

it("emits a user snapshot and persists the link in the collaborative document", async () => {
  const doc = new Y.Doc();
  const snapshots: Array<{ source: string; text: string }> = [];
  const awareness = new Awareness(doc);
  const provider = { document: doc, awareness } as unknown as HocuspocusProvider;
  const editor = new Editor({ extensions: buildEditorExtensions({ disableTaskItemToggle: false, getInternalLinkStates: () => ({}), collab: { provider, user: { name: "A", color: "#202020" }, seedContent: null } }),
    onUpdate: ({ editor, transaction }) => snapshots.push({ source: resolveTransactionSource(transaction), text: JSON.stringify(editor.getJSON()) }),
  });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  // Same initial seed operation as the real collaboration controller.
  editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }, false);
  editor.commands.insertContent("[[反链目标");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(insertPageLink(editor, { from: 1, to: 7 }, { id: "target", title: "反链目标笔记" })).toBe(true);
  expect(snapshots.some((snapshot) => snapshot.source === "user" && snapshot.text.includes("/notes/target"))).toBe(true);
  const restoredDoc = new Y.Doc();
  Y.applyUpdate(restoredDoc, Y.encodeStateAsUpdate(doc));
  const restored = new Editor({ extensions: [StarterKit.configure({ history: false }), Link, Collaboration.configure({ document: restoredDoc })] });
  expect(restored.getHTML()).toContain('href="/notes/target"');
  restored.destroy(); editor.destroy(); awareness.destroy(); doc.destroy(); restoredDoc.destroy();
});
