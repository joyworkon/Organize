// 开发用「假后端」客户端：实现 supabase-js 查询链的最小子集，用内存数据驱动 UI。
// 仅当 NEXT_PUBLIC_MOCK_BACKEND=true 时由 client.ts 返回。接真实后端后删掉即可。
import { mockDb, MOCK_USER } from "./mock-data";

type Filter = { method: string; column: string; value: unknown };
type OrderBy = { column: string; ascending: boolean };

function genId(table: string) {
  return `${table}-${Math.random().toString(36).slice(2, 10)}`;
}

// 链式查询构造器：支持 select/insert/update/delete + 常见过滤器，且可 await
class MockQuery implements PromiseLike<{ data: any; count: number | null; error: null }> {
  private table: string;
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: Filter[] = [];
  private orderBy: OrderBy | null = null;
  private payload: any = null;
  private wantCount = false;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private returnSingle = false;
  private selectAfterMutate = false;

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
        if (f.method === "is") return row[f.column] == null;
        return true;
      })
    );
  }

  select(_cols?: string, opts?: { count?: string }) {
    if (this.op !== "insert" && this.op !== "update" && this.op !== "delete") {
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
  upsert(payload: any, _opts?: { onConflict?: string }) {
    this.op = "insert";
    this.payload = payload;
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
  is() {
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

    if (this.op === "insert") {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = items.map((it) => ({
        id: it.id || genId(this.table),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...it,
      }));
      rows.push(...inserted);
      const data = this.returnSingle ? inserted[0] : inserted;
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
      from: () => ({
        upload: async () => ({ data: { path: "mock/path.png" }, error: null }),
        getPublicUrl: (name: string) => ({
          data: { publicUrl: `https://picsum.photos/seed/${encodeURIComponent(name)}/400` },
        }),
      }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
}
