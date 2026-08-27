import { describe, expect, it } from "vitest";
import { fromDateInput, toDateInput } from "./task-date-picker";

/** 按本地墙钟拼 YYYY-MM-DD，作为参照实现 */
function localDateStr(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

describe("task-date-picker 日期串本地化", () => {
  it("toDateInput 对任意时刻都返回本地日期而非 UTC 日期", () => {
    // 全天任务存的是本地零点 ISO（东八区 = 前一天 16:00Z），取任一天验证
    const instants = [
      new Date(2026, 7, 27, 0, 0, 0).toISOString(),
      new Date(2026, 7, 27, 23, 59, 0).toISOString(),
      new Date(Date.UTC(2026, 0, 1, 23, 30)).toISOString(), // 跨日敏感时刻
    ];
    for (const iso of instants) {
      expect(toDateInput(iso)).toBe(localDateStr(new Date(iso)));
    }
  });

  it("toDateInput 空值与非法值安全", () => {
    expect(toDateInput(null)).toBe("");
    expect(toDateInput("not-a-date")).toBe("");
  });

  it("fromDateInput ↔ toDateInput 往返保持同一天（全天 00:00 场景）", () => {
    const local = new Date(2026, 7, 27);
    const iso = fromDateInput(localDateStr(local));
    const back = toDateInput(iso);
    // 若实现退化为 toISOString 截断，在 UTC 以东时区此断言失败
    expect(back).toBe(localDateStr(local));
    expect(fromDateInput(localDateStr(local), "20:05").endsWith("Z")).toBe(true);
  });
});
