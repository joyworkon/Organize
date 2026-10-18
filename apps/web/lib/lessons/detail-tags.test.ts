import { describe, expect, it } from "vitest";
import type { Tag } from "@organize/shared";
import {
  LESSON_TAGS_LOAD_ERROR_MESSAGE,
  nextAllTagsAfterLoad,
  planLessonTagSave,
  resolveLessonTagsAfterLoad,
} from "./detail-tags";

const tag = (id: string, name = id): Tag => ({
  id,
  user_id: "u1",
  name,
  color: "blue",
});

const allTags = [tag("a", "alpha"), tag("b", "beta"), tag("c", "gamma")];

describe("resolveLessonTagsAfterLoad", () => {
  it("filters allTags by linked tag ids and keeps allTags order", () => {
    const plan = resolveLessonTagsAfterLoad({
      allTags,
      allTagsError: null,
      links: [{ tag_id: "c" }, { tag_id: "a" }],
      linksError: null,
    });
    expect(plan.tags.map((t) => t.id)).toEqual(["a", "c"]);
    expect(plan.loadError).toBeNull();
  });

  it("ignores link ids that are not in allTags", () => {
    const plan = resolveLessonTagsAfterLoad({
      allTags,
      allTagsError: null,
      links: [{ tag_id: "b" }, { tag_id: "missing" }],
      linksError: null,
    });
    expect(plan.tags.map((t) => t.id)).toEqual(["b"]);
    expect(plan.loadError).toBeNull();
  });

  it("treats an empty successful links list as a real no-tags state without error", () => {
    const plan = resolveLessonTagsAfterLoad({
      allTags,
      allTagsError: null,
      links: [],
      linksError: null,
    });
    expect(plan.tags).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("on allTags error returns no tags and surfaces the error message", () => {
    const plan = resolveLessonTagsAfterLoad({
      allTags: null,
      allTagsError: { message: "tags boom" },
      links: [{ tag_id: "a" }],
      linksError: null,
    });
    expect(plan.tags).toEqual([]);
    expect(plan.loadError).toBe("tags boom");
  });

  it("on links error returns no tags and surfaces the error message", () => {
    const plan = resolveLessonTagsAfterLoad({
      allTags,
      allTagsError: null,
      links: null,
      linksError: { message: "links boom" },
    });
    expect(plan.tags).toEqual([]);
    expect(plan.loadError).toBe("links boom");
  });

  it("falls back to the constant message when the error message is blank", () => {
    const plan = resolveLessonTagsAfterLoad({
      allTags,
      allTagsError: null,
      links: null,
      linksError: { message: "   " },
    });
    expect(plan.tags).toEqual([]);
    expect(plan.loadError).toBe(LESSON_TAGS_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without error as a failure too, not as no tags", () => {
    const fromTags = resolveLessonTagsAfterLoad({
      allTags: null,
      allTagsError: null,
      links: [{ tag_id: "a" }],
      linksError: null,
    });
    expect(fromTags.tags).toEqual([]);
    expect(fromTags.loadError).toBe(LESSON_TAGS_LOAD_ERROR_MESSAGE);

    const fromLinks = resolveLessonTagsAfterLoad({
      allTags,
      allTagsError: null,
      links: null,
      linksError: null,
    });
    expect(fromLinks.tags).toEqual([]);
    expect(fromLinks.loadError).toBe(LESSON_TAGS_LOAD_ERROR_MESSAGE);
  });
});

describe("nextAllTagsAfterLoad", () => {
  it("on success replaces the previous snapshot (even with an empty list) and clears the error", () => {
    const plan = nextAllTagsAfterLoad({
      previous: allTags,
      data: [],
      error: null,
    });
    expect(plan.tags).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("on error keeps the previous snapshot and surfaces the error message", () => {
    const plan = nextAllTagsAfterLoad({
      previous: allTags,
      data: null,
      error: { message: "tags boom" },
    });
    expect(plan.tags).toEqual(allTags);
    expect(plan.loadError).toBe("tags boom");
  });

  it("falls back to the constant message when the error message is blank", () => {
    const plan = nextAllTagsAfterLoad({
      previous: allTags,
      data: null,
      error: { message: "   " },
    });
    expect(plan.tags).toEqual(allTags);
    expect(plan.loadError).toBe(LESSON_TAGS_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without error as a failure too, keeping the previous snapshot", () => {
    const plan = nextAllTagsAfterLoad({
      previous: allTags,
      data: null,
      error: null,
    });
    expect(plan.tags).toEqual(allTags);
    expect(plan.loadError).toBe(LESSON_TAGS_LOAD_ERROR_MESSAGE);
  });

  it("keeps an empty previous snapshot on first-screen failure (no fake tag list)", () => {
    const plan = nextAllTagsAfterLoad({
      previous: [],
      data: null,
      error: { message: "boom" },
    });
    expect(plan.tags).toEqual([]);
    expect(plan.loadError).toBe("boom");
  });
});

describe("planLessonTagSave", () => {
  it("skips touching lesson_tags while tags are in a load-error state", () => {
    const plan = planLessonTagSave({
      tagsLoadError: LESSON_TAGS_LOAD_ERROR_MESSAGE,
      selectedTagIds: ["a", "b"],
    });
    expect(plan).toEqual({ kind: "skip" });
  });

  it("replaces with the selected ids when there is no load error", () => {
    const plan = planLessonTagSave({
      tagsLoadError: null,
      selectedTagIds: ["a", "b"],
    });
    expect(plan).toEqual({ kind: "replace", tagIds: ["a", "b"] });
  });

  it("replaces with an empty list (clearing all tags) when nothing is selected and no load error", () => {
    const plan = planLessonTagSave({ tagsLoadError: null, selectedTagIds: [] });
    expect(plan).toEqual({ kind: "replace", tagIds: [] });
  });
});
