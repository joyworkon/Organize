// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveNoteToTrash } from "./delete-note";
import { mutateTrash } from "@/lib/trash/client";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { makeNoteCreateOp, readNoteCreates } from "@/lib/offline/note-queue";
import { readNoteDeletes } from "@/lib/offline/note-delete-queue";

vi.mock("@/lib/trash/client", () => ({ mutateTrash: vi.fn() }));
vi.mock("@/lib/offline/network", () => ({ isOnline: vi.fn() }));
vi.mock("@/lib/offline/note-sync", () => ({ isNetworkSaveError: vi.fn() }));

const mockMutateTrash = vi.mocked(mutateTrash);
const mockIsOnline = vi.mocked(isOnline);
const mockIsNetworkSaveError = vi.mocked(isNetworkSaveError);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockIsOnline.mockReturnValue(true);
  mockIsNetworkSaveError.mockReturnValue(false);
});

describe("moveNoteToTrash", () => {
  it("在线：走 mutate_trash 软删除并返回 deleted", async () => {
    mockMutateTrash.mockResolvedValue(1);
    await expect(moveNoteToTrash("n1")).resolves.toBe("deleted");
    expect(mockMutateTrash).toHaveBeenCalledWith("note", ["n1"], "soft_delete");
    expect(readNoteDeletes(localStorage)).toEqual([]);
  });

  it("在线且该笔记仍在离线创建队列：删除成功同时丢弃草稿（防回放插回）", async () => {
    mockMutateTrash.mockResolvedValue(1);
    localStorage.setItem(
      "organize:offline:note-creates:v1",
      JSON.stringify([makeNoteCreateOp({ id: "n1", user_id: "u1" })])
    );
    await expect(moveNoteToTrash("n1")).resolves.toBe("deleted");
    expect(readNoteCreates(localStorage)).toEqual([]);
    expect(readNoteDeletes(localStorage)).toEqual([]);
  });

  it("离线：不入 RPC，直接入删除队列并返回 queued", async () => {
    mockIsOnline.mockReturnValue(false);
    await expect(moveNoteToTrash("n1")).resolves.toBe("queued");
    expect(mockMutateTrash).not.toHaveBeenCalled();
    expect(readNoteDeletes(localStorage).map((op) => op.id)).toEqual(["n1"]);
  });

  it("离线 + 仍在创建队列：丢弃草稿而不是入删除队列", async () => {
    mockIsOnline.mockReturnValue(false);
    localStorage.setItem(
      "organize:offline:note-creates:v1",
      JSON.stringify([makeNoteCreateOp({ id: "n1", user_id: "u1" })])
    );
    await expect(moveNoteToTrash("n1")).resolves.toBe("queued");
    expect(readNoteCreates(localStorage)).toEqual([]);
    expect(readNoteDeletes(localStorage)).toEqual([]);
  });

  it("网络错误按离线删除处理（入队待回放）", async () => {
    mockMutateTrash.mockRejectedValue(new Error("fetch failed"));
    mockIsNetworkSaveError.mockReturnValue(true);
    await expect(moveNoteToTrash("n1")).resolves.toBe("queued");
    expect(readNoteDeletes(localStorage).map((op) => op.id)).toEqual(["n1"]);
  });

  it("非网络错误原样抛出，不入队", async () => {
    const failure = new Error("permission denied");
    mockMutateTrash.mockRejectedValue(failure);
    await expect(moveNoteToTrash("n1")).rejects.toBe(failure);
    expect(readNoteDeletes(localStorage)).toEqual([]);
  });
});
