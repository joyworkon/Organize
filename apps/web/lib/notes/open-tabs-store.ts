"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface NoteTabMeta {
  id: string;
  title: string;
  icon: string | null;
}

interface OpenTabsState {
  /** 顶部标签页条当前打开的笔记（Chrome 式多开，持久化到 localStorage） */
  tabs: NoteTabMeta[];
  /** 最近打开的笔记（侧边栏「最近」分组，按最近访问排序） */
  recents: NoteTabMeta[];
  /** 打开/激活笔记：已存在则刷新元信息，否则追加标签页并置顶最近列表 */
  openTab: (meta: NoteTabMeta) => void;
  /** 笔记标题/图标变化后同步标签页与最近列表的展示 */
  updateMeta: (meta: NoteTabMeta) => void;
  /** 拖拽排序：把 fromId 移动到 toId 的位置 */
  moveTab: (fromId: string, toId: string) => void;
  /** 关闭标签页；返回关闭后应导航到的相邻标签页 id（Chrome 行为），无则 null */
  removeTab: (id: string) => string | null;
  /** 从标签页与最近列表中彻底移除（笔记被删除/移入垃圾箱时） */
  forgetNote: (id: string) => void;
}

const MAX_TABS = 20;
const MAX_RECENTS = 12;

export const useOpenTabsStore = create<OpenTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      recents: [],

      openTab: (meta) =>
        set((state) => {
          const exists = state.tabs.some((tab) => tab.id === meta.id);
          const tabs = exists
            ? state.tabs.map((tab) => (tab.id === meta.id ? meta : tab))
            : [...state.tabs, meta].slice(-MAX_TABS);
          const recents = [
            meta,
            ...state.recents.filter((item) => item.id !== meta.id),
          ].slice(0, MAX_RECENTS);
          return { tabs, recents };
        }),

      updateMeta: (meta) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === meta.id ? meta : tab)),
          recents: state.recents.map((item) => (item.id === meta.id ? meta : item)),
        })),

      /** 拖拽排序：把 fromId 移动到 toId 的位置（Chrome 式拖拽换位） */
      moveTab: (fromId, toId) =>
        set((state) => {
          const from = state.tabs.findIndex((tab) => tab.id === fromId);
          const to = state.tabs.findIndex((tab) => tab.id === toId);
          if (from < 0 || to < 0 || from === to) return state;
          const tabs = [...state.tabs];
          const [moved] = tabs.splice(from, 1);
          tabs.splice(to, 0, moved);
          return { tabs };
        }),

      removeTab: (id) => {
        const { tabs } = get();
        const index = tabs.findIndex((tab) => tab.id === id);
        const next = tabs.filter((tab) => tab.id !== id);
        set({ tabs: next });
        // Chrome 行为：关闭当前标签页后聚焦左侧邻位，最左侧则取右侧
        const neighbor = next[Math.min(index, next.length - 1)];
        return index >= 0 ? neighbor?.id ?? null : null;
      },

      forgetNote: (id) =>
        set((state) => ({
          tabs: state.tabs.filter((tab) => tab.id !== id),
          recents: state.recents.filter((item) => item.id !== id),
        })),
    }),
    { name: "organize:note-open-tabs" }
  )
);
