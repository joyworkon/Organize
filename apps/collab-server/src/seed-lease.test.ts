import { describe, expect, it } from "vitest";
import { SeedLease } from "./seed-lease";

describe("SeedLease", () => {
  it("首个申请获得 grant，随后的申请得到 wait", () => {
    const lease = new SeedLease();
    expect(lease.request()).toBe("grant");
    expect(lease.request()).toBe("wait");
  });

  it("房间非空后 markSeeded，之后一律 deny", () => {
    const lease = new SeedLease();
    lease.markSeeded();
    expect(lease.request()).toBe("deny");
  });

  it("租约到期后惰性回收，等待方获得下一个 grant", () => {
    let t = 0;
    const lease = new SeedLease({ leaseMs: 1000, now: () => t });
    expect(lease.request()).toBe("grant"); // 获胜方
    expect(lease.request()).toBe("wait"); // 等待方
    t = 999;
    expect(lease.request()).toBe("wait"); // 未到期，继续等
    t = 1000;
    expect(lease.request()).toBe("grant"); // 到期回收，原等待方接手
  });

  it(`连续失败达上限后 done，不再授予`, () => {
    let t = 0;
    const lease = new SeedLease({ leaseMs: 1000, maxGrants: 2, now: () => t });
    expect(lease.request()).toBe("grant");
    t = 1000; // 第一个租约到期（失败 1）
    expect(lease.request()).toBe("grant");
    t = 2000; // 失败 2，达到上限
    expect(lease.request()).toBe("deny");
    t = 9999;
    expect(lease.request()).toBe("deny"); // 之后永远 deny
  });

  it("正常写入后 markSeeded 终结播种阶段，与到期状态无关", () => {
    let t = 0;
    const lease = new SeedLease({ leaseMs: 1000, now: () => t });
    expect(lease.request()).toBe("grant");
    lease.markSeeded(); // onChange 观察到内容写入
    t = 9999;
    expect(lease.request()).toBe("deny");
  });
});
