import { describe, expect, it } from "vitest";
import {
  assertDigestBudget,
  buildDigestUserMessage,
  digestKey,
  DigestBudgetError,
  DIGEST_SOURCE_MAX_CHARS,
  DIGEST_TOTAL_MAX_CHARS,
  type DigestSourceInput,
} from "./digest-server";
import { stripHtmlToText } from "./digest-text";

const source = (overrides: Partial<DigestSourceInput> = {}): DigestSourceInput => ({
  sourceType: "reading",
  sourceId: "11111111-1111-1111-1111-111111111111",
  label: "来源甲",
  text: "甲的正文",
  contentHash: "a".repeat(64),
  ...overrides,
});

describe("digest budget", () => {
  it("预算值有定义（单来源 2 万 / 合计 6 万）", () => {
    expect(DIGEST_SOURCE_MAX_CHARS).toBe(20_000);
    expect(DIGEST_TOTAL_MAX_CHARS).toBe(60_000);
  });

  it("正常来源通过并返回合计字符数", () => {
    expect(assertDigestBudget([source(), source({ sourceId: "2".repeat(32) })])).toBe(8);
  });

  it("单来源超限 → DigestBudgetError 且列出超限来源（明确拒绝，不静默截断）", () => {
    try {
      assertDigestBudget([
        source({ text: "甲".repeat(DIGEST_SOURCE_MAX_CHARS + 1) }),
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DigestBudgetError);
      expect((error as Error).message).toContain("来源甲");
      expect((error as Error).message).toContain("缩小选择范围");
    }
  });

  it("合计超限（单来源未超）→ 明确报错", () => {
    try {
      assertDigestBudget([
        source({ text: "x".repeat(19_000) }),
        source({ sourceId: "2".repeat(32), text: "y".repeat(19_000) }),
        source({ sourceId: "3".repeat(32), text: "z".repeat(19_000) }),
        source({ sourceId: "4".repeat(32), text: "w".repeat(19_000) }),
      ]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("超过预算");
    }
  });

  it("来源数上限 20", () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      source({ sourceId: i.toString(16).padStart(32, "0") }),
    );
    expect(() => assertDigestBudget(many)).toThrow(DigestBudgetError);
  });
});

describe("digest key（幂等）", () => {
  it("同来源集合同版本 → 同 key（顺序无关）", async () => {
    const a = [source(), source({ sourceId: "2".repeat(32), sourceType: "memo" as const })];
    const b = [a[1], a[0]];
    expect(await digestKey(a)).toBe(await digestKey(b));
  });

  it("来源内容版本变了（hash 变）→ key 变（新版本新文章）", async () => {
    const a = [source()];
    const b = [source({ contentHash: "b".repeat(64) })];
    expect(await digestKey(a)).not.toBe(await digestKey(b));
  });
});

describe("digest 用户消息（不可信输入隔离）", () => {
  it("来源逐份包进 <material> 标签并编号", () => {
    const message = buildDigestUserMessage([
      source(),
      source({ sourceId: "2".repeat(32), label: "来源乙", sourceType: "memo" as const }),
    ]);
    expect(message).toContain("来源1：来源甲");
    expect(message).toContain("<material>\n甲的正文\n</material>");
    expect(message).toContain("来源2：来源乙");
    expect(message.match(/<material>/g)).toHaveLength(2);
  });
});

describe("stripHtmlToText", () => {
  it("去标签、解实体、折叠空白", () => {
    expect(stripHtmlToText("<p>你好&amp;世界</p><p>第二段</p>")).toBe("你好&世界\n第二段");
    expect(stripHtmlToText("a<br>b")).toBe("a\nb");
    expect(stripHtmlToText("<h1>标题</h1><ul><li>要点一</li></ul>")).toContain("要点一");
  });

  it("空输入返回空串；不做截断（截断是预算层的明确拒绝）", () => {
    expect(stripHtmlToText("")).toBe("");
    const long = stripHtmlToText(`<p>${"字".repeat(50_000)}</p>`);
    expect(long.length).toBe(50_000);
  });
});
