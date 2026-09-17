#!/usr/bin/env node
/**
 * 把 TraeWork 设计系统的单色 SVG 资产（assets/icons/*.svg）生成为本仓库可用的
 * React 图标组件（components/icons/ds-icons.generated.tsx）。
 *
 * 规则（对齐 TraeWork SKILL.md「Iconography」）：
 * - 只用 TraeWork 本地资产，不引外部图标库；不手改路径几何，viewBox / fill 原样保留
 * - 默认渲染 16×16，尺寸由调用方 className（h-4 w-4 等）覆盖
 * - fill="currentColor" ⇒ 亮/暗色自动跟随文字色，无需暗色专用资产
 *
 * 用法：
 *   node scripts/gen-ds-icons.mjs                       # 用默认源目录
 *   TRAEWORK_ICONS=/path/to/assets/icons node scripts/gen-ds-icons.mjs
 * 映射表：scripts/ds-icon-map.json（键 = 代码里用的图标名，值 = TraeWork 文件名）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const sourceDir =
  process.env.TRAEWORK_ICONS || join(repoRoot, "TraeWork Copy/assets/icons");
const mapPath = join(here, "ds-icon-map.json");
const outPath = join(here, "../components/icons/ds-icons.generated.tsx");

if (!existsSync(sourceDir)) {
  console.error(
    `[gen-ds-icons] 找不到 TraeWork 图标目录：${sourceDir}\n` +
      `生成产物已入库，日常开发无需重跑；需要新增图标时用 TRAEWORK_ICONS 指定目录。`
  );
  process.exit(1);
}

const map = JSON.parse(readFileSync(mapPath, "utf8"));
const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));

/** 取出 viewBox 与 <svg> 内部内容，丢掉 width/height（尺寸由组件控制） */
function parseSvg(file) {
  const raw = readFileSync(file, "utf8").trim();
  const open = raw.match(/<svg\b([^>]*)>/i);
  if (!open) throw new Error(`无法解析 SVG：${file}`);
  const viewBox = open[1].match(/viewBox="([^"]+)"/i);
  if (!viewBox) throw new Error(`SVG 缺少 viewBox：${file}`);
  const body = raw
    .slice(open.index + open[0].length, raw.lastIndexOf("</svg>"))
    .replace(/\s+/g, " ")
    .trim();
  return { viewBox: viewBox[1], body };
}

const lines = [];
lines.push("// 本文件由 scripts/gen-ds-icons.mjs 生成，请勿手改。");
lines.push("// 源：TraeWork 设计系统 assets/icons（映射见 scripts/ds-icon-map.json）");
lines.push('import { dsIcon } from "./ds-icon-factory";');
lines.push("");

let count = 0;
for (const [name, fileName] of entries) {
  const file = join(sourceDir, fileName);
  if (!existsSync(file)) {
    console.error(`[gen-ds-icons] 映射指向的文件不存在：${fileName}`);
    process.exit(1);
  }
  const { viewBox, body } = parseSvg(file);
  const escaped = body.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  lines.push(`/** TraeWork: ${fileName} */`);
  lines.push(
    `export const ${name} = dsIcon(${JSON.stringify(name)}, ${JSON.stringify(
      viewBox
    )}, "${escaped}");`
  );
  count += 1;
}
lines.push("");
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`[gen-ds-icons] 生成 ${count} 个图标 -> ${outPath}`);
