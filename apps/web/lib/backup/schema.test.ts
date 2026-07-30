import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  createBackupV2,
  inspectBackupV2,
  type BackupData,
} from "./schema";
import { prepareRestorePayload } from "./restore";

const ids = {
  reading: "10000000-0000-4000-8000-000000000001",
  note: "20000000-0000-4000-8000-000000000001",
  tag: "30000000-0000-4000-8000-000000000001",
  task: "40000000-0000-4000-8000-000000000001",
  checklist: "50000000-0000-4000-8000-000000000001",
  lesson: "60000000-0000-4000-8000-000000000001",
  highlight: "70000000-0000-4000-8000-000000000001",
  favorite: "80000000-0000-4000-8000-000000000001",
  version: "90000000-0000-4000-8000-000000000001",
  thread: "a0000000-0000-4000-8000-000000000001",
  comment: "b0000000-0000-4000-8000-000000000001",
  suggestion: "c0000000-0000-4000-8000-000000000001",
};
const timestamp = "2026-07-29T12:00:00.000Z";

function fixtureData(): BackupData {
  return {
    reading_items: [
      {
        id: ids.reading,
        url: "https://example.com",
        title: "Reading",
        content: "<p>Article</p>",
        excerpt: null,
        cover_image: null,
        reading_status: "read",
        reading_progress: 1,
        is_pinned: false,
        started_reading_at: timestamp,
        completed_reading_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    notes: [
      {
        id: ids.note,
        title: "Note",
        content: {
          type: "doc",
          content: [
            {
              type: "text",
              marks: [
                {
                  type: "link",
                  attrs: { href: `/library/${ids.reading}#block-a` },
                },
              ],
              text: "linked",
            },
          ],
        },
        reading_item_id: ids.reading,
        is_pinned: false,
        full_width: false,
        font_family: "default",
        small_font: false,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    tags: [{ id: ids.tag, name: "Tag", color: "blue", created_at: timestamp }],
    item_tags: [{ item_id: ids.reading, tag_id: ids.tag }],
    note_tags: [{ note_id: ids.note, tag_id: ids.tag }],
    tasks: [
      {
        id: ids.task,
        title: "Task",
        description: null,
        status: "done",
        priority: "medium",
        category: "work",
        due_date: null,
        estimated_minutes: null,
        actual_minutes: null,
        reading_item_id: ids.reading,
        note_id: ids.note,
        is_pinned: false,
        sort_order: 0,
        completed_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    task_checklists: [
      {
        id: ids.checklist,
        task_id: ids.task,
        content: "Check",
        is_completed: true,
        sort_order: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    task_tags: [{ task_id: ids.task, tag_id: ids.tag }],
    lessons: [
      {
        id: ids.lesson,
        title: "Lesson",
        content: { type: "doc", content: [] },
        lesson_type: "lesson",
        task_id: ids.task,
        reading_item_id: ids.reading,
        note_id: ids.note,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    lesson_tags: [{ lesson_id: ids.lesson, tag_id: ids.tag }],
    highlights: [
      {
        id: ids.highlight,
        reading_item_id: ids.reading,
        content: "Highlight",
        note: null,
        color: "yellow",
        anchor_path: null,
        anchor_offset: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    favorites: [
      {
        id: ids.favorite,
        target_type: "note",
        target_id: ids.note,
        note: null,
        created_at: timestamp,
      },
    ],
    note_versions: [
      {
        id: ids.version,
        note_id: ids.note,
        content: { type: "doc", content: [] },
        title: "Version",
        message: null,
        created_at: timestamp,
      },
    ],
    note_comment_threads: [
      {
        id: ids.thread,
        note_id: ids.note,
        block_id: "block-a",
        resolved_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    note_comments: [
      {
        id: ids.comment,
        thread_id: ids.thread,
        body: "Comment",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    note_suggestions: [
      {
        id: ids.suggestion,
        note_id: ids.note,
        block_id: "block-a",
        original_block: { type: "paragraph" },
        proposed_block: { type: "paragraph" },
        status: "pending",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
  };
}

describe("Backup V2", () => {
  it("validates a complete dependency-ordered fixture", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    expect(inspectBackupV2(JSON.stringify(backup))).toEqual({
      ok: true,
      backup,
      issues: [],
    });
    expect(Object.keys(backup.data)).toEqual(BACKUP_TABLES);
  });

  it("rejects missing tables, broken references, and sensitive fields", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    const data = backup.data as Record<string, Array<Record<string, unknown>>>;
    delete data.note_comments;
    data.notes[0].user_id = "leak";
    data.tasks[0].note_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.code)).toEqual(
        expect.arrayContaining([
          "INVALID_TABLE",
          "SENSITIVE_FIELD",
          "BROKEN_REFERENCE",
        ])
      );
    }
  });

  it("rejects V1 and unknown versions", () => {
    expect(inspectBackupV2({ version: 1 })).toMatchObject({ ok: false });
    expect(inspectBackupV2({ format: "organize-backup", version: 99 })).toMatchObject({
      ok: false,
    });
  });

  it("remaps every UUID, relationship, favorite target, and internal link", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    let sequence = 1;
    const payload = prepareRestorePayload(backup, () => {
      const suffix = String(sequence++).padStart(12, "0");
      return `f0000000-0000-4000-8000-${suffix}`;
    });

    const restoredReadingId = String(payload.data.reading_items[0].id);
    const restoredNoteId = String(payload.data.notes[0].id);
    expect(restoredReadingId).not.toBe(ids.reading);
    expect(restoredNoteId).not.toBe(ids.note);
    expect(payload.data.notes[0].reading_item_id).toBe(restoredReadingId);
    expect(payload.data.tasks[0].note_id).toBe(restoredNoteId);
    expect(payload.data.favorites[0].target_id).toBe(restoredNoteId);
    expect(JSON.stringify(payload.data.notes[0].content)).toContain(
      `/library/${restoredReadingId}#block-a`
    );
    expect(JSON.stringify(payload)).not.toContain(ids.note);
    expect(JSON.stringify(payload)).not.toContain(ids.reading);
  });

  it("accepts legacy backups that omit full_width / font_family / small_font", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    const data = backup.data as Record<string, Array<Record<string, unknown>>>;
    delete data.notes[0].full_width;
    delete data.notes[0].font_family;
    delete data.notes[0].small_font;

    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(true);

    const payload = prepareRestorePayload(backup as any);
    expect(payload.data.notes[0].full_width).toBe(false);
    expect(payload.data.notes[0].font_family).toBe("default");
    expect(payload.data.notes[0].small_font).toBe(false);
  });

  it("rejects invalid font_family values and preserves valid ones", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    const bad = JSON.parse(JSON.stringify(backup));
    (bad.data as any).notes[0].font_family = "comic-sans";
    expect(inspectBackupV2(bad).ok).toBe(false);

    const good = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    (good.data as any).notes[0].font_family = "serif";
    (good.data as any).notes[0].full_width = true;
    (good.data as any).notes[0].small_font = true;
    expect(inspectBackupV2(good).ok).toBe(true);

    const payload = prepareRestorePayload(good as any);
    expect(payload.data.notes[0].font_family).toBe("serif");
    expect(payload.data.notes[0].full_width).toBe(true);
    expect(payload.data.notes[0].small_font).toBe(true);
  });
});
