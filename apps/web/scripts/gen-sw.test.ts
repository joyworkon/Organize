import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A02：gen-sw.mjs 版本注入合同。
 * public/sw.js 是构建产物（gitignore），这些断言守住「模板 → 产物」的替换规则：
 * 版本注入完整、无残留占位符、非数字版本拒绝（缓存清理按数字排序依赖它）。
 */

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const genScript = join(scriptsDir, "gen-sw.mjs");
const outputPath = join(scriptsDir, "..", "public", "sw.js");

function runGen(env: Record<string, string>) {
  return execFileSync("node", [genScript], {
    cwd: join(scriptsDir, ".."),
    env: { ...process.env, ...env },
  }).toString();
}

describe("gen-sw 版本注入", () => {
  it("SW_BUILD_VERSION 注入完整：版本常量注入、占位符无残留", () => {
    const out = runGen({ SW_BUILD_VERSION: "1700000000000" });
    expect(out).toContain("BUILD_VERSION=1700000000000");
    const sw = readFileSync(outputPath, "utf8");
    expect(sw).toContain('const BUILD_VERSION = "1700000000000"');
    // 缓存名在 SW 内由模板常量插值（organize-static-${BUILD_VERSION}）
    expect(sw).toContain("organize-static-${BUILD_VERSION}");
    expect(sw).not.toContain("__SW_BUILD_VERSION__");
  });

  it("模板行为关键点在位：SKIP_WAITING 门控、只有导航允许 HTML 回退", () => {
    runGen({ SW_BUILD_VERSION: "1700000000001" });
    const sw = readFileSync(outputPath, "utf8");
    // 安装阶段不无条件 skipWaiting（安全激活）；消息驱动的接管
    expect(sw).toContain('"SKIP_WAITING"');
    // 只有导航请求回退 HTML（→ /offline），脚本/资源绝不回退到页面 HTML
    expect(sw).toMatch(/request\.mode === "navigate"/);
    expect(sw).not.toMatch(/caches\.match\("\/"\)/);
  });

  it("无 SW_BUILD_VERSION 时用时间戳生成（产物存在且为数字版本）", () => {
    const out = runGen({});
    expect(out).toMatch(/BUILD_VERSION=\d{10,}/);
    expect(existsSync(outputPath)).toBe(true);
    const sw = readFileSync(outputPath, "utf8");
    expect(sw).toMatch(/const BUILD_VERSION = "\d{10,}";/);
  });

  it("非数字版本被拒绝（缓存清理依赖数字排序，不允许任意字符串）", () => {
    expect(() => runGen({ SW_BUILD_VERSION: "v3-abc" })).toThrow();
  });
});
