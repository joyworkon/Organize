import { redirect } from "next/navigation";

// 速记已并入「资料库」（/library?view=memos，阶段 C）：列表、输入、标签、
// 转笔记能力都在资料库速记视图内。保留此路由作存量链接/书签的兼容重定向，
// query 参数（memo 深链、compose、tag 等）原样透传。
export default async function MemosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) query.append(key, v);
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }
  query.set("view", "memos");
  const qs = query.toString();
  redirect(`/library${qs ? `?${qs}` : ""}`);
}
