import { expect, test } from "@playwright/test";

/**
 * 全站安全响应头。基础头必须强制下发；CSP 以仅上报模式上线——收齐真实违规报告之前
 * 既不能静默变成强制（会把编辑器拦坏），也不能消失。
 * 仅上报模式下浏览器照样派发 securitypolicyviolation，所以策略与应用是否匹配也能在这里断言。
 */

const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

test("页面与 API 都带基础安全头", async ({ request }) => {
  for (const path of ["/login", "/api/health"]) {
    const headers = (await request.get(path)).headers();
    for (const [name, value] of Object.entries(BASE_HEADERS)) {
      expect(headers[name], `${path} ${name}`).toBe(value);
    }
  }
});

test("CSP 只以 Report-Only 下发，并指向站内上报端点", async ({ request }) => {
  const headers = (await request.get("/login")).headers();

  expect(headers["content-security-policy"]).toBeUndefined();
  const csp = headers["content-security-policy-report-only"] ?? "";
  expect(csp).toContain("report-uri /api/csp-report");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'self'");
  // 构建期注入的 Supabase 地址必须进 connect-src，且 REST 与 Realtime（ws/wss）成对——
  // 缺任何一半，真实后端下对应请求都会被上报。不断言具体地址：它取决于构建时的环境。
  expect(csp).toMatch(/connect-src 'self' (https?):\/\/(\S+) ws(?:s)?:\/\/\2(?:;|$)/);
});

test("CSP 违规上报端点：合法 204、畸形 400、超限 413", async ({ request }) => {
  const ok = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({
      "csp-report": { "blocked-uri": "inline", "effective-directive": "script-src" },
    }),
  });
  expect(ok.status()).toBe(204);

  const malformed = await request.post("/api/csp-report", { data: "not a report" });
  expect(malformed.status()).toBe(400);

  const oversized = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: "x".repeat(9 * 1024),
  });
  expect(oversized.status()).toBe(413);
});

test("核心页面在仅上报策略下不产生 CSP 违规", async ({ page }) => {
  await page.addInitScript(() => {
    const sink = window as unknown as { __cspViolations: string[] };
    sink.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      sink.__cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    localStorage.setItem("organize:onboarded", "1");
  });

  for (const path of ["/login", "/", "/notes", "/library", "/tasks"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const violations = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations
    );
    expect(violations, path).toEqual([]);
  }
});
