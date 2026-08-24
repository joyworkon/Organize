import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  internalLinkKeyFromHref,
  type InternalLinkStateRow,
} from "@/lib/note-links";

export const internalLinkStateKey = new PluginKey("organizeInternalLinkState");

interface InternalLinkStateOptions {
  getStates: () => Record<string, InternalLinkStateRow>;
}

interface LinkRange {
  from: number;
  to: number;
  href: string;
  row: InternalLinkStateRow;
}

export const InternalLinkStateDecorations = Extension.create<InternalLinkStateOptions>({
  name: "organizeInternalLinkState",

  addOptions() {
    return {
      getStates: () => ({}),
    };
  },

  addProseMirrorPlugins() {
    const getStates = this.options.getStates;
    return [
      new Plugin({
        key: internalLinkStateKey,
        props: {
          decorations(state) {
            const states = getStates();
            const ranges: LinkRange[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText) return true;
              const href = node.marks.find((mark) => mark.type.name === "link")?.attrs.href;
              if (typeof href !== "string") return true;
              const key = internalLinkKeyFromHref(href);
              const row = key ? states[key] : null;
              if (!row || row.state === "active") return true;

              const last = ranges[ranges.length - 1];
              if (last && last.to === pos && last.href === href && last.row.state === row.state) {
                last.to = pos + node.nodeSize;
              } else {
                ranges.push({ from: pos, to: pos + node.nodeSize, href, row });
              }
              return true;
            });

            const decorations: Decoration[] = [];
            ranges.forEach((range, index) => {
              const message =
                range.row.state === "deleted"
                  ? "链接目标已在垃圾箱中"
                  : "链接目标不存在或无权访问";
              decorations.push(
                Decoration.inline(range.from, range.to, {
                  class: "is-invalid-internal-link",
                  "data-link-state": range.row.state,
                  "aria-disabled": "true",
                  title: message,
                }),
                Decoration.widget(
                  range.to,
                  () => {
                    const label = document.createElement("span");
                    label.className = "invalid-internal-link-label";
                    label.dataset.linkState = range.row.state;
                    label.textContent =
                      range.row.state === "deleted" ? "（已删除）" : "（链接失效）";
                    label.title = message;
                    return label;
                  },
                  { key: `invalid-link:${range.href}:${range.from}:${index}`, side: 1 }
                )
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
