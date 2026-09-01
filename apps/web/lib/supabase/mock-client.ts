// 开发用「假后端」客户端：实现 supabase-js 查询链的最小子集，用内存数据驱动 UI。
// 仅当 NEXT_PUBLIC_MOCK_BACKEND=true 时由 client.ts 返回。接真实后端后删掉即可。
import { mockDb, MOCK_USER } from "./mock-data";

type Filter = { method: string; column: string; value: unknown };
type OrderBy = { column: string; ascending: boolean };

function genId(table: string) {
  return `${table}-${Math.random().toString(36).slice(2, 10)}`;
}

// 063/064 暴露给客户端的协作管理 RPC：mock 一律显式报错（不支持必须明确，不能假成功）
const COLLAB_MANAGEMENT_RPCS = new Set([
  "find_user_by_email",
  "ensure_personal_workspace",
  "workspace_role",
  "shares_workspace_with",
  "create_workspace",
  "add_workspace_member",
  "update_workspace_member_role",
  "transfer_workspace_ownership",
  "remove_workspace_member",
  "grant_resource",
  "revoke_resource",
  "transfer_resource_acl",
  "reclaim_resource",
  "transfer_note_ownership",
  "transfer_reading_item_ownership",
  "transfer_task_ownership",
  "save_note_with_tasks_v2",
]);

// 链式查询构造器：支持 select/insert/update/delete + 常见过滤器，且可 await
class MockQuery implements PromiseLike<{ data: any; count: number | null; error: null }> {
  private table: string;
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private filters: Filter[] = [];
  private orderBy: OrderBy | null = null;
  private payload: any = null;
  private wantCount = false;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private returnSingle = false;
  private selectAfterMutate = false;
  private upsertConflictColumns: string[] = [];

  constructor(table: string) {
    this.table = table;
  }

  private rows(): any[] {
    return mockDb[this.table] || (mockDb[this.table] = []);
  }

  // 按 eq / in 过滤（其它过滤器忽略，UI 预览够用）
  private applyFilters(rows: any[]): any[] {
    return rows.filter((row) =>
      this.filters.every((f) => {
        if (f.method === "eq") return row[f.column] === f.value;
        if (f.method === "neq") return row[f.column] !== f.value;
        if (f.method === "in") return (f.value as unknown[]).includes(row[f.column]);
        if (f.method === "is") {
          return f.value === null
            ? row[f.column] == null
            : row[f.column] === f.value;
        }
        return true;
      })
    );
  }

  select(_cols?: string, opts?: { count?: string }) {
    if (this.op !== "insert" && this.op !== "upsert" && this.op !== "update" && this.op !== "delete") {
      this.op = "select";
    } else {
      this.selectAfterMutate = true;
    }
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(payload: any) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload: any, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.upsertConflictColumns = (opts?.onConflict || "id")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    return this;
  }
  update(payload: any) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ method: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push({ method: "neq", column, value });
    return this;
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ method: "in", column, value });
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push({ method: "is", column, value });
    return this;
  }
  or() {
    return this;
  }
  ilike() {
    return this;
  }
  like() {
    return this;
  }
  gte() {
    return this;
  }
  lte() {
    return this;
  }
  contains() {
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    if (this.rangeFrom === null) {
      this.rangeFrom = 0;
      this.rangeTo = n - 1;
    }
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single() {
    this.returnSingle = true;
    return this;
  }
  maybeSingle() {
    this.returnSingle = true;
    return this;
  }

  private run(): { data: any; count: number | null; error: null } {
    const rows = this.rows();

    if (this.op === "insert" || this.op === "upsert") {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      const now = new Date().toISOString();
      const mutated = items.map((it) => {
        const existing = this.op === "upsert"
          ? rows.find((row) =>
              this.upsertConflictColumns.every((column) => row[column] === it[column])
            )
          : null;
        if (existing) {
          Object.assign(existing, it, { updated_at: now });
          return existing;
        }
        const inserted = {
          id: it.id || genId(this.table),
          created_at: now,
          updated_at: now,
          ...it,
        };
        rows.push(inserted);
        return inserted;
      });
      const data = this.returnSingle ? mutated[0] : mutated;
      return { data: this.selectAfterMutate || this.returnSingle ? data : null, count: null, error: null };
    }

    if (this.op === "update") {
      const targets = this.applyFilters(rows);
      targets.forEach((row) => Object.assign(row, this.payload, { updated_at: new Date().toISOString() }));
      const data = this.returnSingle ? targets[0] ?? null : targets;
      return { data: this.selectAfterMutate || this.returnSingle ? data : null, count: null, error: null };
    }

    if (this.op === "delete") {
      const targets = new Set(this.applyFilters(rows));
      mockDb[this.table] = rows.filter((r) => !targets.has(r));
      return { data: null, count: null, error: null };
    }

    // select
    let result = this.applyFilters(rows);
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = [...result].sort((a, b) => {
        const aVal = a[column];
        const bVal = b[column];
        if (aVal < bVal) return ascending ? -1 : 1;
        if (aVal > bVal) return ascending ? 1 : -1;
        return 0;
      });
    }
    const count = result.length;
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      result = result.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.returnSingle) {
      return { data: result[0] ?? null, count: null, error: null };
    }
    return { data: result, count: this.wantCount ? count : null, error: null };
  }

  then<TResult1 = { data: any; count: number | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; count: number | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

const noSession = { data: { session: { user: MOCK_USER } }, error: null };

interface MockStorageObject {
  data: Blob;
  publicUrl: string | null;
}

const mockStorageObjects = new Map<string, MockStorageObject>();

function storageObjectKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

function mockStorageBucket(bucket: string) {
  return {
    upload: async (
      path: string,
      body: Blob | ArrayBuffer | ArrayBufferView | string,
      options?: { contentType?: string; upsert?: boolean }
    ) => {
      const key = storageObjectKey(bucket, path);
      if (mockStorageObjects.has(key) && !options?.upsert) {
        return { data: null, error: { message: "对象已存在" } };
      }
      const source = body instanceof Blob ? body : new Blob([body as BlobPart]);
      const data = options?.contentType && !source.type
        ? new Blob([await source.arrayBuffer()], { type: options.contentType })
        : source;
      const previous = mockStorageObjects.get(key);
      if (previous?.publicUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previous.publicUrl);
      }
      mockStorageObjects.set(key, { data, publicUrl: null });
      return { data: { path }, error: null };
    },
    download: async (path: string) => {
      const object = mockStorageObjects.get(storageObjectKey(bucket, path));
      if (!object) return { data: null, error: { message: "对象不存在" } };
      return { data: object.data, error: null };
    },
    remove: async (paths: string[]) => {
      for (const path of paths) {
        const key = storageObjectKey(bucket, path);
        const object = mockStorageObjects.get(key);
        if (object?.publicUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(object.publicUrl);
        }
        mockStorageObjects.delete(key);
      }
      return { data: paths.map((name) => ({ name })), error: null };
    },
    getPublicUrl: (path: string) => {
      const object = mockStorageObjects.get(storageObjectKey(bucket, path));
      if (object && !object.publicUrl) {
        object.publicUrl = typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(object.data)
          : `mock-storage://${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`;
      }
      return {
        data: {
          publicUrl:
            object?.publicUrl
            || `https://picsum.photos/seed/${encodeURIComponent(path)}/400`,
        },
      };
    },
  };
}

function extractTaskRefs(content: unknown): Array<{ blockId: string; taskId: string }> {
  const refs: Array<{ blockId: string; taskId: string }> = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const value = node as {
      type?: string;
      attrs?: { id?: unknown; taskId?: unknown };
      content?: unknown[];
    };
    if (
      value.type === "taskItem"
      && typeof value.attrs?.id === "string"
      && typeof value.attrs?.taskId === "string"
    ) {
      refs.push({ blockId: value.attrs.id, taskId: value.attrs.taskId });
    }
    value.content?.forEach(visit);
  };
  visit(content);
  return refs;
}

// 059 任务原子变更协议的 mock 实现：与真实 RPC 同语义（幂等/版本校验/白名单字段）
function updateTaskAtomic(args: Record<string, any>) {
  const taskId = args.p_task_id as string;
  const patch = (args.p_patch ?? {}) as Record<string, unknown>;
  const expected = args.p_expected_sync_version ?? null;
  const mutationId = args.p_mutation_id ?? null;
  const mutations = (mockDb.task_mutations ??= []);
  if (mutationId && mutations.some((row) => row.user_id === MOCK_USER.id && row.mutation_id === mutationId)) {
    return { data: { status: "already_applied" }, error: null };
  }
  const task = (mockDb.tasks || []).find(
    (row) => row.id === taskId && row.user_id === MOCK_USER.id && row.deleted_at == null
  );
  if (!task) return { data: { status: "not_found" }, error: null };
  const currentVersion = Number(task.sync_version ?? 0);
  if (expected !== null && currentVersion !== Number(expected)) {
    return { data: { status: "conflict", current_sync_version: currentVersion }, error: null };
  }
  // 与迁移 059 相同的白名单字段（null 覆盖语义一致）
  const WHITELIST = [
    "title", "description", "status", "priority", "category", "due_date",
    "estimated_minutes", "actual_minutes", "reading_item_id", "note_id",
    "is_pinned", "completed_at", "sort_order", "list_id",
    "schedule_start_at", "schedule_end_at", "all_day", "timezone",
    "recurrence_rule", "series_id", "source_id", "reference_managed",
  ];
  for (const key of WHITELIST) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) task[key] = patch[key];
  }
  task.sync_version = currentVersion + 1;
  task.updated_at = new Date().toISOString();
  if (mutationId) {
    mutations.push({ user_id: MOCK_USER.id, mutation_id: mutationId, task_id: taskId, created_at: new Date().toISOString() });
  }
  return { data: { status: "applied", sync_version: task.sync_version }, error: null };
}

function saveNoteWithTasks(args: Record<string, any>) {
  const note = (mockDb.notes || []).find(
    (row) => row.id === args.p_note_id && row.user_id === MOCK_USER.id
  );
  if (!note) return { data: { status: "not_found" }, error: null };

  const currentRevision = Number(note.content_revision ?? 0);
  if (currentRevision !== Number(args.p_expected_note_revision ?? 0)) {
    return {
      data: { status: "conflict_note", current_revision: currentRevision },
      error: null,
    };
  }

  const mutations = Array.isArray(args.p_task_mutations) ? args.p_task_mutations : [];
  for (const mutation of mutations) {
    const task = (mockDb.tasks || []).find(
      (row) => row.id === mutation.task_id && row.user_id === MOCK_USER.id
    );
    if (!task) {
      return {
        data: {
          status: "conflict_task",
          task_id: mutation.task_id,
          reason: "not_found_or_forbidden",
        },
        error: null,
      };
    }
  }

  const snapshot = args.p_note_snapshot || {};
  Object.assign(note, {
    content: args.p_content,
    title: args.p_title ?? note.title,
    ...snapshot,
    // 066 归属列：mock 单用户世界里调用者就是属主（对齐真实 v1 语义）
    last_edit_by: MOCK_USER.id,
    content_revision: currentRevision + 1,
    updated_at: new Date().toISOString(),
  });

  const taskRevisions: Record<string, number> = {};
  for (const mutation of mutations) {
    const task = mockDb.tasks.find((row) => row.id === mutation.task_id);
    if (!task) continue;
    task.title = mutation.title ?? task.title;
    task.status = mutation.status ?? task.status;
    task.sync_version = Number(task.sync_version ?? 0) + 1;
    task.updated_at = new Date().toISOString();
    taskRevisions[task.id] = task.sync_version;
  }

  mockDb.task_item_refs = (mockDb.task_item_refs || []).filter(
    (row) => row.note_id !== note.id
  );
  mockDb.task_item_refs.push(
    ...extractTaskRefs(args.p_content).map((ref) => ({
      id: genId("task_item_refs"),
      user_id: MOCK_USER.id,
      note_id: note.id,
      task_id: ref.taskId,
      block_id: ref.blockId,
    }))
  );

  return {
    data: {
      status: "ok",
      note_revision: currentRevision + 1,
      task_revisions: taskRevisions,
    },
    error: null,
  };
}

function reachesTask(startId: string, targetId: string): boolean {
  const stack = [startId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === targetId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    for (const edge of mockDb.task_dependencies || []) {
      if (edge.task_id === currentId) stack.push(edge.depends_on_task_id);
    }
  }
  return false;
}

function addTaskDependency(args: Record<string, any>) {
  const taskId = String(args.p_task_id || "");
  const prerequisiteId = String(args.p_depends_on_task_id || "");
  const tasks = mockDb.tasks || [];
  const task = tasks.find((row) => row.id === taskId && row.user_id === MOCK_USER.id);
  const prerequisite = tasks.find(
    (row) => row.id === prerequisiteId && row.user_id === MOCK_USER.id
  );
  if (!task || !prerequisite) {
    return { data: null, error: { message: "依赖任务不存在或无权访问" } };
  }
  if (taskId === prerequisiteId) {
    return { data: null, error: { message: "任务不能依赖自身" } };
  }
  const edges = mockDb.task_dependencies || (mockDb.task_dependencies = []);
  if (
    edges.some(
      (edge) =>
        edge.task_id === taskId &&
        edge.depends_on_task_id === prerequisiteId
    )
  ) {
    return { data: null, error: { message: "该依赖已存在" } };
  }
  if (reachesTask(prerequisiteId, taskId)) {
    return { data: null, error: { message: "任务依赖不能形成循环" } };
  }

  edges.push({
    task_id: taskId,
    depends_on_task_id: prerequisiteId,
    user_id: MOCK_USER.id,
    created_at: new Date().toISOString(),
  });
  return {
    data: {
      status: "created",
      task_id: taskId,
      depends_on_task_id: prerequisiteId,
    },
    error: null,
  };
}

function removeTaskDependency(args: Record<string, any>) {
  const taskId = String(args.p_task_id || "");
  const prerequisiteId = String(args.p_depends_on_task_id || "");
  const before = (mockDb.task_dependencies || []).length;
  mockDb.task_dependencies = (mockDb.task_dependencies || []).filter(
    (edge) =>
      edge.user_id !== MOCK_USER.id ||
      edge.task_id !== taskId ||
      edge.depends_on_task_id !== prerequisiteId
  );
  return {
    data: {
      status:
        mockDb.task_dependencies.length === before ? "not_found" : "removed",
    },
    error: null,
  };
}

function convertHighlightReference(args: Record<string, any>) {
  const highlight = (mockDb.highlights || []).find(
    (row) => row.id === args.p_highlight_id && row.user_id === MOCK_USER.id
  );
  const targetType = args.p_target_type;
  if (!highlight) {
    return { data: null, error: { message: "高亮不存在或无权访问" } };
  }
  if (targetType !== "note" && targetType !== "task") {
    return { data: null, error: { message: "目标类型必须是 note 或 task" } };
  }
  const reading = (mockDb.reading_items || []).find(
    (row) =>
      row.id === highlight.reading_item_id &&
      row.user_id === MOCK_USER.id &&
      row.deleted_at == null
  );
  if (!reading) {
    return { data: null, error: { message: "来源阅读不存在或已删除" } };
  }

  const field = targetType === "note" ? "note_id" : "task_id";
  if (highlight[field]) {
    return {
      data: {
        status: "existing",
        target_type: targetType,
        target_id: highlight[field],
      },
      error: null,
    };
  }

  const now = new Date().toISOString();
  const targetId = genId(targetType === "note" ? "notes" : "tasks");
  if (targetType === "note") {
    mockDb.notes.push({
      id: targetId,
      user_id: MOCK_USER.id,
      title: reading.title || highlight.content.slice(0, 120) || "阅读高亮",
      content: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: highlight.content }],
              },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: `来源：${reading.url}` }],
          },
        ],
      },
      reading_item_id: reading.id,
      content_revision: 0,
      is_pinned: false,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
    highlight.note_id = targetId;
    const linkedTask = mockDb.tasks.find(
      (row) =>
        row.id === highlight.task_id &&
        row.user_id === MOCK_USER.id &&
        row.deleted_at == null &&
        row.note_id == null
    );
    if (linkedTask) linkedTask.note_id = targetId;
  } else {
    mockDb.tasks.push({
      id: targetId,
      user_id: MOCK_USER.id,
      parent_task_id: null,
      title: highlight.content.slice(0, 120),
      description: `${highlight.content}\n\n来源：《${reading.title || "无标题文章"}》`,
      status: "todo",
      priority: "medium",
      category: "study",
      due_date: null,
      estimated_minutes: null,
      actual_minutes: null,
      reading_item_id: reading.id,
      note_id: highlight.note_id || null,
      is_pinned: false,
      sort_order: 0,
      completed_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
    highlight.task_id = targetId;
  }
  highlight.updated_at = now;

  return {
    data: { status: "created", target_type: targetType, target_id: targetId },
    error: null,
  };
}

function getHighlightReferenceStates(args: Record<string, any>) {
  const rows = (mockDb.highlights || [])
    .filter(
      (highlight) =>
        highlight.user_id === MOCK_USER.id &&
        (!args.p_reading_item_id || highlight.reading_item_id === args.p_reading_item_id) &&
        (!args.p_note_id || highlight.note_id === args.p_note_id) &&
        (!args.p_task_id || highlight.task_id === args.p_task_id)
    )
    .map((highlight) => {
      const reading = mockDb.reading_items.find(
        (row) => row.id === highlight.reading_item_id && row.user_id === MOCK_USER.id
      );
      const note = highlight.note_id
        ? mockDb.notes.find((row) => row.id === highlight.note_id && row.user_id === MOCK_USER.id)
        : null;
      const task = highlight.task_id
        ? mockDb.tasks.find((row) => row.id === highlight.task_id && row.user_id === MOCK_USER.id)
        : null;
      const state = (id: unknown, row: any) =>
        !id ? null : !row ? "missing" : row.deleted_at ? "deleted" : "active";
      return {
        highlight_id: highlight.id,
        reading_item_id: highlight.reading_item_id,
        reading_title: reading?.title ?? null,
        reading_state: state(highlight.reading_item_id, reading),
        note_id: highlight.note_id ?? null,
        note_title: note?.title ?? null,
        note_state: state(highlight.note_id, note),
        task_id: highlight.task_id ?? null,
        task_title: task?.title ?? null,
        task_state: state(highlight.task_id, task),
      };
    });
  return { data: rows, error: null };
}

function getLinkedContentStates(args: Record<string, any>) {
  const reading = args.p_reading_item_id
    ? mockDb.reading_items.find(
        (row) => row.id === args.p_reading_item_id && row.user_id === MOCK_USER.id
      )
    : null;
  const note = args.p_note_id
    ? mockDb.notes.find((row) => row.id === args.p_note_id && row.user_id === MOCK_USER.id)
    : null;
  const task = args.p_task_id
    ? mockDb.tasks.find((row) => row.id === args.p_task_id && row.user_id === MOCK_USER.id)
    : null;
  const state = (id: unknown, row: any) =>
    !id ? null : !row ? "missing" : row.deleted_at ? "deleted" : "active";
  return {
    data: [
      {
        reading_item_id: args.p_reading_item_id || null,
        reading_title: reading?.title ?? null,
        reading_state: state(args.p_reading_item_id, reading),
        note_id: args.p_note_id || null,
        note_title: note?.title ?? null,
        note_state: state(args.p_note_id, note),
        task_id: args.p_task_id || null,
        task_title: task?.title ?? null,
        task_state: state(args.p_task_id, task),
      },
    ],
    error: null,
  };
}

function getNoteContentLinkStates(args: Record<string, any>) {
  const rows = [
    ...(args.p_note_ids || []).map((id: string) => {
      const note = mockDb.notes.find((row) => row.id === id && row.user_id === MOCK_USER.id);
      return {
        resource_type: "note",
        resource_id: id,
        title: note?.title ?? null,
        state: !note ? "missing" : note.deleted_at ? "deleted" : "active",
      };
    }),
    ...(args.p_reading_item_ids || []).map((id: string) => {
      const reading = mockDb.reading_items.find(
        (row) => row.id === id && row.user_id === MOCK_USER.id
      );
      return {
        resource_type: "reading",
        resource_id: id,
        title: reading?.title ?? null,
        state: !reading ? "missing" : reading.deleted_at ? "deleted" : "active",
      };
    }),
  ];
  return { data: rows, error: null };
}

export function createMockClient(): any {
  return {
    auth: {
      getUser: async () => ({ data: { user: MOCK_USER }, error: null }),
      getSession: async () => noSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: { user: MOCK_USER }, error: null }),
      signUp: async () => ({ data: { user: MOCK_USER }, error: null }),
      signOut: async () => ({ error: null }),
      exchangeCodeForSession: async () => noSession,
    },
    from: (table: string) => new MockQuery(table),
    storage: {
      from: (bucket: string) => mockStorageBucket(bucket),
    },
    rpc: async (name: string, args: Record<string, any> = {}) => {
      if (name === "save_note_with_tasks") return saveNoteWithTasks(args);
      if (name === "update_task_atomic") return updateTaskAtomic(args);
      if (name === "add_task_dependency") return addTaskDependency(args);
      if (name === "remove_task_dependency") return removeTaskDependency(args);
      if (name === "convert_highlight_reference") return convertHighlightReference(args);
      if (name === "get_highlight_reference_states") return getHighlightReferenceStates(args);
      if (name === "get_linked_content_states") return getLinkedContentStates(args);
      if (name === "get_note_content_link_states") return getNoteContentLinkStates(args);
      // P5-02 卡 4：mock 单用户世界里调用者确实拥有一切，resource_role 如实返回 owner，
      // 保存管线因此永远走 v1 主链，单用户行为不变。
      if (name === "resource_role") {
        return { data: args?.p_resource_type === "note" ? "owner" : null, error: null };
      }
      // 协作管理面（空间 / 授权 / 查人）mock 一概不支持：显式报错而不是静默假成功，
      // 分享面板负责把这个错误如实展示给用户。
      if (COLLAB_MANAGEMENT_RPCS.has(name)) {
        return {
          data: null,
          error: { message: "mock 后端不支持协作成员管理，请在连接真实后端后使用", code: "P5-02-MOCK" },
        };
      }
      return { data: null, error: null };
    },
  };
}
