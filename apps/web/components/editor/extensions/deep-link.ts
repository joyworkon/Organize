import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const deepLinkKey = new PluginKey<string | null>("organizeBlockDeepLink");

function hashBlockId() {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#block-")) return null;
  return decodeURIComponent(window.location.hash.slice(7));
}

export const BlockDeepLink = Extension.create({
  name: "organizeBlockDeepLink",

  addProseMirrorPlugins() {
    return [new Plugin<string | null>({
      key: deepLinkKey,
      state: {
        init: hashBlockId,
        apply(transaction, value) {
          return transaction.getMeta(deepLinkKey) ?? value;
        },
      },
      props: {
        decorations(state) {
          const blockId = deepLinkKey.getState(state);
          if (!blockId) return null;
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.attrs?.id === blockId) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, {
                class: "is-deep-linked",
                id: `block-${blockId}`,
              }));
              return false;
            }
            return true;
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
      view(view) {
        let removeTimer: ReturnType<typeof setTimeout> | null = null;
        const locate = () => {
          const blockId = hashBlockId();
          view.dispatch(view.state.tr.setMeta(deepLinkKey, blockId));
          if (!blockId) return;
          requestAnimationFrame(() => {
            const element = view.dom.querySelector(`#${CSS.escape(`block-${blockId}`)}`);
            element?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
          if (removeTimer) clearTimeout(removeTimer);
          removeTimer = setTimeout(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(deepLinkKey, null));
          }, 2200);
        };
        window.addEventListener("hashchange", locate);
        locate();
        return {
          destroy() {
            window.removeEventListener("hashchange", locate);
            if (removeTimer) clearTimeout(removeTimer);
          },
        };
      },
    })];
  },
});
