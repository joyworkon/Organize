// 播种租约（P5-03 生产化卡，ADR 0003「空房间并发播种竞态」的根除）。
//
// 背景：房间为空（无 blob 可回放）时，需要用 notes.content 播种一次。播种由客户端
// 执行（编辑器 schema 持有全文档映射，服务端不重复维护一份会漂移的 schema），
// 但「哪个客户端有资格播种」由服务端仲裁：同一房间最多一个在途租约，
// 两个客户端同时进入空房间不再各自播种出重复段落。
//
// 协议（无状态消息，payload 为 JSON 字符串）：
//   client → server: {"t":"seed-req"}
//   server → client: {"t":"seed-grant"}   唯一赢家，才允许 setContent 播种
//                    {"t":"seed-wait"}    已有在途租约，稍后再问（对方可能在写）
//                    {"t":"seed-deny"}    播种阶段已结束（房间非空 / 连续失败封顶）
//
// 服务端单线程，request→grant 判定天然原子；租约到期无需定时器，由下一次
// request() 惰性回收。纯类 + 注入时钟，便于单测。

export type SeedLeaseDecision = "grant" | "wait" | "deny";
export type SeedLeaseState = "idle" | "granted" | "done";

export interface SeedLeaseOptions {
  /** 租约时长：获准方须在此窗口内把内容写进房间（超时未写视为失败） */
  leaseMs?: number;
  /** 授予次数上限：连续失败（到期未写）后标记 done，停止播种保护数据 */
  maxGrants?: number;
  /** 注入时钟（单测用） */
  now?: () => number;
}

export class SeedLease {
  private leaseState: SeedLeaseState = "idle";
  private grantCount = 0;
  private leaseDeadline = 0;
  private readonly leaseMs: number;
  private readonly maxGrants: number;
  private readonly now: () => number;

  constructor(options: SeedLeaseOptions = {}) {
    this.leaseMs = options.leaseMs ?? 8000;
    this.maxGrants = options.maxGrants ?? 3;
    this.now = options.now ?? Date.now;
  }

  get state(): SeedLeaseState {
    return this.leaseState;
  }

  /** 房间已有内容（blob 回放成功 / onChange 观察到任何更新）：播种阶段永久结束 */
  markSeeded(): void {
    this.leaseState = "done";
  }

  /**
   * 客户端申请播种资格。到期租约在此惰性回收（获胜方超时未写入视为失败，
   * 回到 idle 让等待方有机会接手；累计失败达上限则 done，之后一律 deny——
   * 内容与播种源对不上时，继续播种只会反复制造重复内容）。
   */
  request(): SeedLeaseDecision {
    if (this.leaseState === "granted" && this.now() >= this.leaseDeadline) {
      this.leaseState = "idle";
    }
    if (this.leaseState === "done") return "deny";
    if (this.leaseState === "granted") return "wait";
    if (this.grantCount >= this.maxGrants) {
      this.leaseState = "done";
      return "deny";
    }
    this.grantCount += 1;
    this.leaseState = "granted";
    this.leaseDeadline = this.now() + this.leaseMs;
    return "grant";
  }
}
