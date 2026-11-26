// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveNoteToTrash } from "./delete-note";
import { mutateTrash } from "@/lib/trash/client";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import {
  makeNoteCreateOp,
  noteCreatesStorageKey,
  readNoteCreates,
} from "@/lib/offline/note-queue";
import { noteDeletesStorageKey, readNoteDeletes } from "@/lib/offline/note-delete-queue";

vi.mock("@/lib/trash/client", () => ({ mutateTrash: vi.fn() }));
vi.mock("@/lib/offline/network", () => ({ isOnline: vi.fn() }));
vi.mock("@/lib/offline/note-sync", () => ({ isNetworkSaveError: vi.fn() }));

const mockMutateTrash = vi.mocked(mutateTrash);
const mockIsOnline = vi.mocked(isOnline);
const mockIsNetworkSaveError = vi.mocked(isNetworkSaveError);

const ME = "u1";
const SOMEONE_ELSE = "u2";

function seedPendingCreate(userId: string, noteId: string) {
  localStorage.setItem(noteCreatesStorageKey(userId), JSON.stringify([makeNoteCreateOp({ id: noteId, user_id: userId })]));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockIsOnline.mockReturnValue(true);
  mockIsNetworkSaveError.mockReturnValue(false);
});

describe("moveNoteToTrash", () => {
  it("在线：走 mutate_trash 软删除并返回 deleted", async () => {
    mockMutateTrash.mockResolvedValue(1);
    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("deleted");
    expect(mockMutateTrash).toHaveBeenCalledWith("note", ["n1"], "soft_delete");
    expect(readNoteDeletes(localStorage, ME)).toEqual([]);
  });

  it("在线且该笔记仍在离线创建队列：删除成功同时丢弃草稿（防回放插回）", async () => {
    mockMutateTrash.mockResolvedValue(1);
    seedPendingCreate(ME, "n1");
    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("deleted");
    expect(readNoteCreates(localStorage, ME)).toEqual([]);
    expect(readNoteDeletes(localStorage, ME)).toEqual([]);
  });

  it("离线：不入 RPC，直接入删除队列并返回 queued", async () => {
    mockIsOnline.mockReturnValue(false);
    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("queued");
    expect(mockMutateTrash).not.toHaveBeenCalled();
    expect(readNoteDeletes(localStorage, ME).map((op) => op.id)).toEqual(["n1"]);
  });

  it("离线 + 仍在创建队列：丢弃草稿而不是入删除队列", async () => {
    mockIsOnline.mockReturnValue(false);
    seedPendingCreate(ME, "n1");
    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("queued");
    expect(readNoteCreates(localStorage, ME)).toEqual([]);
    expect(readNoteDeletes(localStorage, ME)).toEqual([]);
  });

  it("网络错误按离线删除处理（入队待回放）", async () => {
    mockMutateTrash.mockRejectedValue(new Error("fetch failed"));
    mockIsNetworkSaveError.mockReturnValue(true);
    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("queued");
    expect(readNoteDeletes(localStorage, ME).map((op) => op.id)).toEqual(["n1"]);
  });

  it("非网络错误原样抛出，不入队", async () => {
    const failure = new Error("permission denied");
    mockMutateTrash.mockRejectedValue(failure);
    await expect(moveNoteToTrash(ME, "n1")).rejects.toBe(failure);
    expect(readNoteDeletes(localStorage, ME)).toEqual([]);
  });
});

describe("moveNoteToTrash：只动本人名下的离线队列", () => {
  it("在线删除：别人账号名下同一笔记的离线草稿不受影响", async () => {
    mockMutateTrash.mockResolvedValue(1);
    seedPendingCreate(SOMEONE_ELSE, "n1");

    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("deleted");

    // 那是上一位还没同步的笔记，不能因为我在自己的账号里删了同一个 id 就被丢掉
    expect(readNoteCreates(localStorage, SOMEONE_ELSE).map((op) => op.note.id)).toEqual(["n1"]);
    expect(readNoteCreates(localStorage, ME)).toEqual([]);
  });

  it("离线删除：删除请求排在本人队列里，不进别人的队列", async () => {
    mockIsOnline.mockReturnValue(false);

    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("queued");

    expect(readNoteDeletes(localStorage, ME).map((op) => op.id)).toEqual(["n1"]);
    expect(readNoteDeletes(localStorage, SOMEONE_ELSE)).toEqual([]);
    // 副作用检查：没有凭空给别人创建出队列
    expect(localStorage.getItem(noteDeletesStorageKey(SOMEONE_ELSE))).toBeNull();
  });

  it("离线删除：别人名下同 id 的草稿不被丢弃，删除请求排进本人队列", async () => {
    mockIsOnline.mockReturnValue(false);
    seedPendingCreate(SOMEONE_ELSE, "n1");

    await expect(moveNoteToTrash(ME, "n1")).resolves.toBe("queued");

    expect(readNoteCreates(localStorage, SOMEONE_ELSE).map((op) => op.note.id)).toEqual(["n1"]);
    expect(readNoteDeletes(localStorage, ME).map((op) => op.id)).toEqual(["n1"]);
  });
});
