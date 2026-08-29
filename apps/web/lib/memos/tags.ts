// 速记 #标签 解析：#后连续非空白非#字符为一个标签，剥掉尾部常用标点，
// 全局去重、保持出现顺序。API 路由与 mock shim 共用此实现，保证行为一致。
const TRAILING_PUNCTUATION = /[。，、！？：；.,!?;:]+$/;

export function parseMemoTags(content: string): string[] {
  const tags: string[] = [];
  const matches = content.match(/#[^\s#]+/g) || [];
  for (const raw of matches) {
    const tag = raw.slice(1).replace(TRAILING_PUNCTUATION, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
