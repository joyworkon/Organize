import { describe, expect, it, vi } from "vitest";
import {
  MSG_CONFIG_LOAD_FAILED,
  MSG_CONFIG_SAVE_FAILED,
  bootstrapPlugins,
  buildCreateFailedMessage,
  pluginDefaultConfig,
  type BootstrapDeps,
} from "./bootstrap";
import { CommandRegistry } from "@/lib/commands/registry";
import { AppEventBus } from "./events";
import { setCurrentReadingItem } from "./current-context";
import { SlashCommandRegistry } from "./slash-commands";
import type { OrganizePlugin, PluginContext } from "@organize/plugin-sdk";
import type { PluginRecord } from "@organize/shared";

// ---------- 测试夹具 ----------

function makePlugin(id: string, name = id): OrganizePlugin {
  return {
    id,
    name,
    version: "1.0.0",
    description: "test plugin",
    configFields: [
      { key: "enabled_by_default", label: "默认开关", type: "boolean", default: true },
      { key: "no_default", label: "无默认值", type: "text" },
    ],
    extensions: [],
  };
}

function makeRecord(plugin: OrganizePlugin, overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: `rec-${plugin.id}`,
    user_id: "u1",
    name: plugin.name,
    package_name: plugin.id,
    version: plugin.version,
    config: {},
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

interface Harness {
  deps: BootstrapDeps;
  notified: { message: string; variant: string }[];
  registered: OrganizePlugin[];
  activated: { id: string; ctx: PluginContext }[];
  requests: { input: string; init?: RequestInit }[];
}

/**
 * 组装 bootstrapPlugins 的依赖并记录副作用。
 * fetch 由调用方提供，用于精确控制每个请求的成功/失败。
 */
function makeHarness(
  plugins: OrganizePlugin[],
  fetchImpl: (input: string, init?: RequestInit) => Response | Promise<Response>
): Harness {
  const notified: { message: string; variant: string }[] = [];
  const registered: OrganizePlugin[] = [];
  const activated: { id: string; ctx: PluginContext }[] = [];
  const requests: { input: string; init?: RequestInit }[] = [];

  const trackedFetch = (input: string, init?: RequestInit) => {
    requests.push({ input, init });
    return Promise.resolve(fetchImpl(input, init));
  };

  const deps: BootstrapDeps = {
    plugins,
    userId: "u1",
    fetchImpl: trackedFetch,
    registerPlugin: (plugin) => registered.push(plugin),
    activatePlugin: (id, ctx) => activated.push({ id, ctx }),
    notify: (message, variant) => notified.push({ message, variant }),
  };

  return { deps, notified, registered, activated, requests };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- pluginDefaultConfig ----------

describe("pluginDefaultConfig", () => {
  it("只提取有默认值的字段", () => {
    expect(pluginDefaultConfig(makePlugin("p1"))).toEqual({ enabled_by_default: true });
  });

  it("无配置字段时返回空对象", () => {
    expect(pluginDefaultConfig({ ...makePlugin("p1"), configFields: undefined })).toEqual({});
  });
});

// ---------- bootstrapPlugins ----------

describe("bootstrapPlugins", () => {
  it("已有记录且启用：注册并激活，复用服务端配置，不发创建请求，无通知", async () => {
    const plugin = makePlugin("ai-summary", "AI 摘要");
    const record = makeRecord(plugin, { config: { enabled_by_default: false, extra: 1 } });
    const harness = makeHarness([plugin], () => jsonResponse([record]));

    const result = await bootstrapPlugins(harness.deps);

    expect(result).toEqual({
      registered: 1,
      activated: 1,
      configLoadFailed: false,
      failedCreations: [],
    });
    expect(harness.registered).toEqual([plugin]);
    expect(harness.activated.map((entry) => entry.id)).toEqual(["ai-summary"]);
    // 没有任何 POST（不重复创建记录）
    expect(
      harness.requests.filter((req) => req.init?.method === "POST")
    ).toEqual([]);
    // getConfig 返回服务端记录里的配置
    const ctx = harness.activated[0].ctx;
    expect(ctx.getConfig()).toEqual({ enabled_by_default: false, extra: 1 });
    expect(harness.notified).toEqual([]);
  });

  it("无记录：用默认配置 POST 创建并激活", async () => {
    const plugin = makePlugin("tag-suggest", "标签推荐");
    const created = makeRecord(plugin, { config: { enabled_by_default: true } });
    const harness = makeHarness([plugin], (input, init) => {
      if (init?.method === "POST") return jsonResponse(created, 201);
      return jsonResponse([]); // GET 返回空列表
    });

    const result = await bootstrapPlugins(harness.deps);

    expect(result.activated).toBe(1);
    const post = harness.requests.find((req) => req.init?.method === "POST");
    expect(post).toBeDefined();
    expect(JSON.parse(String(post!.init!.body))).toEqual({
      name: "标签推荐",
      package_name: "tag-suggest",
      version: "1.0.0",
      config: { enabled_by_default: true },
    });
    expect(harness.activated[0].ctx.getConfig()).toEqual({ enabled_by_default: true });
    expect(harness.notified).toEqual([]);
  });

  it("配置读取失败（网络异常）：插件仍注册但不激活，提示一次且不尝试创建", async () => {
    const plugins = [makePlugin("p1"), makePlugin("p2")];
    const harness = makeHarness(plugins, () => Promise.reject(new Error("network down")));

    const result = await bootstrapPlugins(harness.deps);

    expect(result.configLoadFailed).toBe(true);
    expect(result.activated).toBe(0);
    expect(harness.registered).toHaveLength(2);
    expect(harness.notified).toEqual([
      { message: MSG_CONFIG_LOAD_FAILED, variant: "default" },
    ]);
    // 只有一个 GET 请求，没有 POST
    expect(harness.requests.map((req) => req.init?.method ?? "GET")).toEqual(["GET"]);
  });

  it("配置读取失败（HTTP 500）：同样注册不激活并提示", async () => {
    const harness = makeHarness([makePlugin("p1")], () => jsonResponse({ error: "boom" }, 500));

    const result = await bootstrapPlugins(harness.deps);

    expect(result.configLoadFailed).toBe(true);
    expect(result.activated).toBe(0);
    expect(harness.notified[0].message).toBe(MSG_CONFIG_LOAD_FAILED);
    // 提示不透出服务端原始错误
    expect(harness.notified[0].message).not.toContain("boom");
  });

  it("创建记录失败：该插件不激活，其他插件正常，失败插件名聚合提示", async () => {
    const okPlugin = makePlugin("ok", "正常插件");
    const badPlugin = makePlugin("bad", "失败插件");
    const okRecord = makeRecord(okPlugin);
    const harness = makeHarness([okPlugin, badPlugin], (input, init) => {
      if (init?.method === "POST") {
        // 只有 bad 插件会走创建路径
        return jsonResponse({ error: "permission denied for table plugins" }, 500);
      }
      return jsonResponse([okRecord]);
    });

    const result = await bootstrapPlugins(harness.deps);

    expect(result.activated).toBe(1);
    expect(result.failedCreations).toEqual(["失败插件"]);
    expect(harness.activated.map((entry) => entry.id)).toEqual(["ok"]);
    expect(harness.notified).toEqual([
      { message: buildCreateFailedMessage(["失败插件"]), variant: "default" },
    ]);
    // 聚合文案不含原始数据库错误
    expect(harness.notified[0].message).not.toContain("permission denied");
  });

  it("记录存在但 enabled=false：注册不激活，无通知", async () => {
    const plugin = makePlugin("p1");
    const harness = makeHarness(
      [plugin],
      () => jsonResponse([makeRecord(plugin, { enabled: false })])
    );

    const result = await bootstrapPlugins(harness.deps);

    expect(result.activated).toBe(0);
    expect(harness.registered).toHaveLength(1);
    expect(harness.notified).toEqual([]);
  });

  it("无插件：直接返回零计数，不发任何请求", async () => {
    const harness = makeHarness([], () => {
      throw new Error("should not fetch");
    });

    const result = await bootstrapPlugins(harness.deps);

    expect(result).toEqual({
      registered: 0,
      activated: 0,
      configLoadFailed: false,
      failedCreations: [],
    });
    expect(harness.requests).toEqual([]);
  });

  describe("激活后的 PluginContext", () => {
    async function activateWith(
      patchResponse: () => Response | Promise<Response>
    ): Promise<{ harness: Harness; ctx: PluginContext }> {
      const plugin = makePlugin("p1");
      const harness = makeHarness(
        [plugin],
        (input, init) => {
          if (init?.method === "PATCH") return patchResponse();
          return jsonResponse([makeRecord(plugin, { config: { level: 1 } })]);
        }
      );
      await bootstrapPlugins(harness.deps);
      return { harness, ctx: harness.activated[0].ctx };
    }

    it("setConfig 成功：配置更新为服务端返回值", async () => {
      const { harness, ctx } = await activateWith(() =>
        jsonResponse(makeRecord(makePlugin("p1"), { config: { level: 2 } }))
      );
      await ctx.setConfig({ level: 2 });
      expect(ctx.getConfig()).toEqual({ level: 2 });
      expect(harness.notified).toEqual([]);
    });

    it("setConfig 失败：notify destructive 且抛统一文案，不透出原始错误", async () => {
      const { harness, ctx } = await activateWith(() =>
        jsonResponse({ error: "row-level security policy violation" }, 403)
      );
      await expect(ctx.setConfig({ level: 2 })).rejects.toThrow(MSG_CONFIG_SAVE_FAILED);
      expect(harness.notified).toEqual([
        { message: MSG_CONFIG_SAVE_FAILED, variant: "destructive" },
      ]);
      expect(harness.notified[0].message).not.toContain("row-level");
    });

    it("插件 notify：info/success 走 default，error 走 destructive", async () => {
      const { harness, ctx } = await activateWith(() => jsonResponse(makeRecord(makePlugin("p1"))));
      ctx.notify("普通消息");
      ctx.notify("成功消息", "success");
      ctx.notify("出错了", "error");
      expect(harness.notified).toEqual([
        { message: "普通消息", variant: "default" },
        { message: "成功消息", variant: "default" },
        { message: "出错了", variant: "destructive" },
      ]);
    });

    it("getCurrentItem 读取当前阅读条目 provider（默认 null），userId 透传", async () => {
      const { ctx } = await activateWith(() => jsonResponse(makeRecord(makePlugin("p1"))));
      expect(ctx.getCurrentItem()).toBeNull();
      expect(ctx.userId).toBe("u1");
    });

    it("getCurrentItem 反映 provider 中的当前条目", async () => {
      const { ctx } = await activateWith(() => jsonResponse(makeRecord(makePlugin("p1"))));
      const item = { id: "r1", url: "https://example.com", title: "示例" } as never;
      setCurrentReadingItem(item);
      expect(ctx.getCurrentItem()).toBe(item);
      setCurrentReadingItem(null);
      expect(ctx.getCurrentItem()).toBeNull();
    });

    it("注入 dataAccess 时 ctx.data 透传；未注入时为 undefined", async () => {
      const askAI = vi.fn(async () => "摘要");
      const withData = await activateWith(() => jsonResponse(makeRecord(makePlugin("p1"))));
      expect(withData.ctx.data).toBeUndefined();

      const plugin = makePlugin("p2");
      const harness = makeHarness([plugin], () => jsonResponse([makeRecord(plugin)]));
      harness.deps.dataAccess = { askAI };
      await bootstrapPlugins(harness.deps);
      const ctx = harness.activated[0].ctx;
      await expect(ctx.data!.askAI({ instruction: "i", text: "t" })).resolves.toBe("摘要");
      expect(askAI).toHaveBeenCalledWith({ instruction: "i", text: "t" });
    });
  });

  describe("命令与事件注册", () => {
    async function activateWithRegistries() {
      const plugin = makePlugin("p1", "测试插件");
      const harness = makeHarness([plugin], () =>
        jsonResponse([makeRecord(plugin)])
      );
      const commands = new CommandRegistry();
      const events = new AppEventBus();
      const tracked: { pluginId: string; dispose: () => void }[] = [];
      harness.deps.commands = commands;
      harness.deps.events = events;
      harness.deps.trackRegistration = (pluginId, dispose) =>
        tracked.push({ pluginId, dispose });
      await bootstrapPlugins(harness.deps);
      return { harness, commands, events, tracked, ctx: harness.activated[0].ctx };
    }

    it("registerCommand：命令带插件前缀入注册表，section 缺省为插件名，并登记清理", async () => {
      const { commands, tracked, ctx } = await activateWithRegistries();
      const handler = vi.fn();
      ctx.registerCommand!({ id: "summarize", title: "生成摘要", handler });

      const command = commands.get("p1:summarize");
      expect(command?.title).toBe("生成摘要");
      expect(command?.section).toBe("测试插件");
      expect(tracked).toHaveLength(1);
      expect(tracked[0].pluginId).toBe("p1");

      await command?.run();
      expect(handler).toHaveBeenCalledWith(ctx);

      // 登记的清理函数执行后命令从注册表消失（停用时自动回收链路）
      tracked[0].dispose();
      expect(commands.get("p1:summarize")).toBeUndefined();
    });

    it("onAppEvent：订阅进事件总线并登记清理，退订后不再接收", async () => {
      const { events, tracked, ctx } = await activateWithRegistries();
      const handler = vi.fn();
      ctx.onAppEvent!("note:saved", handler);

      events.emit("note:saved", { noteId: "n1", title: "日记" });
      expect(handler).toHaveBeenCalledWith({ noteId: "n1", title: "日记" });
      expect(tracked).toHaveLength(1);

      tracked[0].dispose();
      events.emit("note:saved", { noteId: "n2", title: "第二篇" });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("registerSlashCommand 经 bootstrap 装配：前缀、插件名与清理登记齐全", async () => {
      const plugin = makePlugin("p1", "测试插件");
      const harness = makeHarness([plugin], () => jsonResponse([makeRecord(plugin)]));
      const slashCommands = new SlashCommandRegistry();
      const tracked: { pluginId: string; dispose: () => void }[] = [];
      harness.deps.slashCommands = slashCommands;
      harness.deps.trackRegistration = (pluginId, dispose) =>
        tracked.push({ pluginId, dispose });
      await bootstrapPlugins(harness.deps);
      const ctx = harness.activated[0].ctx;

      const handler = vi.fn();
      ctx.registerSlashCommand!({ id: "weekly-review", label: "生成本周复盘", handler });

      const entry = slashCommands.get("p1:weekly-review");
      expect(entry?.pluginName).toBe("测试插件");
      expect(entry?.command.label).toBe("生成本周复盘");
      expect(entry?.ctx).toBe(ctx);
      expect(tracked).toHaveLength(1);

      tracked[0].dispose();
      expect(slashCommands.get("p1:weekly-review")).toBeUndefined();
    });
  });
});
