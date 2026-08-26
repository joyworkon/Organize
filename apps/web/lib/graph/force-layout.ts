/**
 * X5 知识图谱——确定性力导向布局（纯函数）
 *
 * 设计取舍：
 * - 不引 d3-force：笔记/任务量级（< 500 节点）下 O(n²) 排斥足够快，
 *   手写 ~80 行换来零依赖 + 确定性输出（同输入必同布局，可测试）
 * - 确定性：初始位置按节点 index 环形分布（不用随机数），固定迭代次数
 * - 力模型：库仑排斥（全节点对）+ 胡克弹簧（边）+ 弱向心力（防漂移）
 * - 冷却：alpha 线性衰减，后期位移趋稳
 */

import type { GraphData } from "./build-graph";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface ForceLayoutOptions {
  width: number;
  height: number;
  /** 迭代次数，默认 300 */
  iterations?: number;
  /** 理想边长，默认 120 */
  linkDistance?: number;
  /** 排斥强度，默认 6000 */
  repulsion?: number;
}

/** 确定性哈希 → [0,1)：给初始位置加扰动，打破完美环形的对称性（不用随机数，保证可复现） */
function hash01(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}

export function computeForceLayout(
  graph: GraphData,
  options: ForceLayoutOptions
): LayoutNode[] {
  const { width, height } = options;
  const iterations = options.iterations ?? 300;
  const linkDistance = options.linkDistance ?? 120;
  const repulsion = options.repulsion ?? 6000;
  const n = graph.nodes.length;
  if (n === 0) return [];

  const cx = width / 2;
  const cy = height / 2;
  // 初始环形分布 + 按 id 哈希的半径/角度扰动：半径随节点数增长，避免中心堆叠与对称锁死
  const radius = Math.max(80, Math.min(width, height) / 2 - 60);
  const pos = graph.nodes.map((node, i) => {
    const jitter = hash01(node.id);
    const angle = (2 * Math.PI * i) / n + jitter * 0.9;
    const r = radius * (0.55 + 0.45 * jitter);
    return { id: node.id, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), vx: 0, vy: 0 };
  });
  const indexById = new Map(pos.map((p, i) => [p.id, i]));
  const edges = graph.edges
    .map((e) => ({ s: indexById.get(e.source)!, t: indexById.get(e.target)! }))
    .filter((e) => e.s !== undefined && e.t !== undefined);

  for (let iter = 0; iter < iterations; iter += 1) {
    const alpha = 1 - iter / iterations; // 线性冷却
    // 库仑排斥
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 0.01) {
          dx = 0.1 * (i - j);
          dy = 0.1;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(distSq);
        const force = (repulsion / distSq) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        pos[i].vx += fx;
        pos[i].vy += fy;
        pos[j].vx -= fx;
        pos[j].vy -= fy;
      }
    }
    // 胡克弹簧（边）
    for (const { s, t } of edges) {
      const dx = pos[t].x - pos[s].x;
      const dy = pos[t].y - pos[s].y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - linkDistance) * 0.05 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      pos[s].vx += fx;
      pos[s].vy += fy;
      pos[t].vx -= fx;
      pos[t].vy -= fy;
    }
    // 弱向心力（足够防漂移，又不至于压垮簇间分离）
    for (let i = 0; i < n; i += 1) {
      pos[i].vx += (cx - pos[i].x) * 0.005 * alpha;
      pos[i].vy += (cy - pos[i].y) * 0.005 * alpha;
    }
    // 积分 + 阻尼
    for (let i = 0; i < n; i += 1) {
      pos[i].x += pos[i].vx * 0.5;
      pos[i].y += pos[i].vy * 0.5;
      pos[i].vx *= 0.6;
      pos[i].vy *= 0.6;
    }
  }

  return pos.map(({ id, x, y }) => ({
    id,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
  }));
}
