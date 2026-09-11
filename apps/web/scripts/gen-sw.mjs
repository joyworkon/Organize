// A02：构建期生成 public/sw.js——把 sw.template.js 的版本占位符替换为构建版本。
// 版本必须是纯数字时间戳：单调递增供 SW 激活时按数字保留「当前+上一版」缓存。
// 该文件由 package.json 的 build 脚本调用；public/sw.js 不入库（见 .gitignore）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const version = process.env.SW_BUILD_VERSION ?? `${Date.now()}`;

if (!/^\d+$/.test(version)) {
  console.error(
    `[gen-sw] SW_BUILD_VERSION 必须是纯数字时间戳（供缓存清理按版本排序），收到：${version}`
  );
  process.exit(1);
}

const templatePath = join(here, "sw.template.js");
const outputPath = join(here, "..", "public", "sw.js");
const template = readFileSync(templatePath, "utf8");
const output = template.split("__SW_BUILD_VERSION__").join(version);

writeFileSync(outputPath, output);
console.log(`[gen-sw] public/sw.js 已生成，BUILD_VERSION=${version}`);
