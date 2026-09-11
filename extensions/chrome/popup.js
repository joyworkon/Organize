/**
 * Organize 剪藏 popup 逻辑（MV3，无构建步骤）。
 *
 * - 认证：调用 Organize 站点的 /api/extension/auth（邮箱密码登录 / token 刷新），
 *   凭据存 chrome.storage.local；扩展不需要知道 Supabase 配置。
 * - 保存：向当前标签页注入媒体检测脚本（activeTab 权限，仅点击图标时生效），
 *   调用 /api/extension/collect 走服务端统一收集语义（规范化/去重/抓取/8 字段）。
 * - 媒体提取函数 extractPageMedia 必须自包含（会被序列化后注入页面执行）。
 */

const STORAGE_KEY = "organizeAuth";
const MAX_SAVE_LINKS = 10;

const $ = (id) => document.getElementById(id);

let auth = null; // { baseUrl, accessToken, refreshToken, expiresAt, email }
let tab = null; // 当前活动标签页
let detectedMedia = []; // [{ type, url, title }]
let saving = false;

function normalizeBaseUrl(raw) {
  let url = (raw || "").trim();
  if (!url) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "http://" + url;
  return url.replace(/\/+$/, "");
}

function isValidPageUrl(url) {
  return /^https?:/i.test(url || "");
}

function show(view) {
  $("view-login").classList.toggle("hidden", view !== "login");
  $("view-main").classList.toggle("hidden", view !== "main");
}

function setError(id, message) {
  const el = $(id);
  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
}

async function loadAuth() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  auth = stored[STORAGE_KEY] || null;
}

async function saveAuthSession(payload, baseUrl) {
  auth = {
    baseUrl,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_at || null,
    email: (payload.user && payload.user.email) || "",
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: auth });
}

async function clearAuth() {
  auth = null;
  await chrome.storage.local.remove(STORAGE_KEY);
}

async function apiPost(path, body, accessToken) {
  const res = await fetch(auth.baseUrl + path, {
    method: "POST",
    headers: Object.assign(
      { "Content-Type": "application/json" },
      accessToken ? { Authorization: "Bearer " + accessToken } : {}
    ),
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应按空对象处理 */
  }
  return { ok: res.ok, status: res.status, data };
}

/* ---------------- 页面媒体提取（注入函数，自包含） ---------------- */

/** 此函数在页面上下文执行：不引用外部变量，逻辑与 web 端 lib/extension/media.ts 对齐 */
function extractPageMedia() {
  var results = [];
  var seen = Object.create(null);

  function push(type, rawUrl, title) {
    try {
      var abs = new URL(rawUrl, location.href).href;
      if (!/^https?:/i.test(abs)) return;
      var key = abs.split("#")[0];
      if (seen[key]) return;
      seen[key] = true;
      results.push({
        type: type,
        url: abs,
        title: title ? String(title).trim().slice(0, 200) : null,
      });
    } catch (e) {
      /* 无法解析的链接忽略 */
    }
  }

  function label(el) {
    var node = el;
    while (node && node !== document.body) {
      var v =
        node.getAttribute && (node.getAttribute("title") || node.getAttribute("aria-label"));
      if (v) return v;
      node = node.parentElement;
    }
    return null;
  }

  var AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)(\?|#|$)/i;
  var DIRECT_EXT = /\.(mp4|webm|m4v|mov|ogv|mp3|m4a|aac|wav|ogg|oga|flac|opus)(\?|#|$)/i;

  // 1. video / audio 元素及其 source 子元素
  document.querySelectorAll("video, audio").forEach(function (el) {
    var type = el.tagName.toLowerCase();
    var source = el.currentSrc || el.src || (el.querySelector("source") && el.querySelector("source").src);
    if (source) push(type, source, label(el));
  });

  // 2. 播放器 iframe：归一成标准视频页 URL（服务端 oEmbed 白名单可预览）
  document.querySelectorAll("iframe[src]").forEach(function (el) {
    var out = null;
    try {
      var u = new URL(el.getAttribute("src"), location.href);
      var host = u.hostname.replace(/^www\./, "");
      if (host === "youtube.com" || host === "m.youtube.com") {
        var m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
        if (m) out = "https://www.youtube.com/watch?v=" + m[1];
      } else if (host === "youtu.be") {
        var id = u.pathname.slice(1, 12);
        if (/^[A-Za-z0-9_-]{11}$/.test(id)) out = "https://www.youtube.com/watch?v=" + id;
      } else if (host === "player.bilibili.com") {
        var bvid = u.searchParams.get("bvid");
        if (bvid) {
          var page = u.searchParams.get("page");
          out =
            "https://www.bilibili.com/video/" +
            bvid +
            (page && page !== "1" ? "?p=" + page : "");
        }
      } else if (host === "player.vimeo.com") {
        var vid = u.pathname.split("/").filter(Boolean)[0];
        if (vid && /^\d+$/.test(vid)) out = "https://vimeo.com/" + vid;
      }
    } catch (e) {
      /* ignore */
    }
    if (out) push("video", out, label(el));
  });

  // 3. 页面里的媒体链接
  document.querySelectorAll("a[href]").forEach(function (el) {
    var href = el.getAttribute("href") || "";
    if (!DIRECT_EXT.test(href)) return;
    push(AUDIO_EXT.test(href) ? "audio" : "video", href, el.textContent || label(el));
  });

  return results.slice(0, 12);
}

async function detectMedia() {
  detectedMedia = [];
  if (!tab || typeof tab.id !== "number" || !isValidPageUrl(tab.url)) return;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageMedia,
    });
    const media = Array.isArray(injection && injection.result) ? injection.result : [];
    // iframe 归一后的 URL 可能与页面内链接重复，按 URL 再去重一次并截断
    const seen = new Set();
    detectedMedia = media
      .filter((m) => {
        const key = (m.url || "").split("#")[0];
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_SAVE_LINKS);
  } catch {
    // 受限页面（chrome:// 等）或 CSP 拦截：无媒体可提取，仍可保存链接
    detectedMedia = [];
  }
}

/* ---------------- 渲染 ---------------- */

function renderMain() {
  $("user-email").textContent = auth.email || "已登录";
  $("user-email").title = auth.email || "";

  const title = (tab && tab.title) || "";
  const url = (tab && tab.url) || "";
  $("page-title").textContent = title || url || "（无法读取当前页面）";
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* 非 http(s) 页面原样显示 */
  }
  $("page-host").textContent = host;

  renderMediaList();

  $("save-btn").disabled = !isValidPageUrl(url);
  $("save-btn").textContent = isValidPageUrl(url) ? "保存到稍后读" : "当前页面不支持保存";
  $("save-result").classList.add("hidden");
  setError("save-error", "");
}

function renderMediaList() {
  const section = $("media-section");
  const list = $("media-list");
  list.innerHTML = "";
  section.classList.toggle("hidden", detectedMedia.length === 0);

  detectedMedia.forEach((item, index) => {
    const li = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.index = String(index);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.type === "audio" ? "音频" : "视频";
    const label = document.createElement("span");
    label.className = "media-title";
    label.textContent = item.title || item.url;
    label.title = item.url;
    li.append(checkbox, badge, label);
    list.appendChild(li);
  });
}

function renderResult(result) {
  const box = $("save-result");
  box.innerHTML = "";
  box.classList.remove("hidden");

  const statusLine = document.createElement("div");
  if (result.status === "saved" || result.status === "saved-link-only") {
    statusLine.className = "status-ok";
    statusLine.textContent =
      result.status === "saved" ? "✓ 已保存到稍后读" : "✓ 已保存（未能抓取正文，媒体链接已保留）";
  } else if (result.status === "duplicate") {
    statusLine.textContent = "该链接已在稍后读中";
  } else {
    statusLine.className = "status-ok";
    statusLine.textContent = "保存失败";
  }
  box.appendChild(statusLine);

  if (result.itemId) {
    const link = document.createElement("a");
    link.href = auth.baseUrl + "/library/" + result.itemId;
    link.target = "_blank";
    link.textContent = "打开条目 ↗";
    box.appendChild(link);
  }
  if (detectedMedia.length > 0 && result.status !== "duplicate") {
    const note = document.createElement("div");
    note.style.marginTop = "4px";
    note.style.color = "var(--muted)";
    note.textContent = "已附带 " + detectedMedia.length + " 条媒体链接";
    box.appendChild(note);
  }
}

/* ---------------- 动作 ---------------- */

async function handleLogin(event) {
  event.preventDefault();
  setError("login-error", "");
  const baseUrl = normalizeBaseUrl($("login-base-url").value);
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!baseUrl || !email || !password) {
    setError("login-error", "请填写服务地址、邮箱和密码");
    return;
  }
  const submit = $("login-submit");
  submit.disabled = true;
  submit.textContent = "登录中…";
  try {
    const res = await fetch(baseUrl + "/api/extension/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      setError("login-error", data.error || "登录失败，请检查账号与服务地址");
      return;
    }
    await saveAuthSession(data, baseUrl);
    renderMain();
  } catch {
    setError("login-error", "无法连接服务地址，请确认 Organize 已启动且地址正确");
  } finally {
    submit.disabled = false;
    submit.textContent = "登录";
  }
}

async function refreshAccessToken() {
  if (!auth || !auth.refreshToken) return false;
  try {
    const res = await apiPost("/api/extension/auth", {
      action: "refresh",
      refresh_token: auth.refreshToken,
    });
    if (!res.ok || !res.data.access_token) return false;
    await saveAuthSession(res.data, auth.baseUrl);
    return true;
  } catch {
    return false;
  }
}

async function collect(mediaLinks) {
  const res = await apiPost(
    "/api/extension/collect",
    { url: tab.url, title: tab.title, mediaLinks },
    auth.accessToken
  );
  if (res.status !== 401) return res;
  // access token 过期：刷新后重试一次
  const refreshed = await refreshAccessToken();
  if (!refreshed) return res;
  return apiPost(
    "/api/extension/collect",
    { url: tab.url, title: tab.title, mediaLinks },
    auth.accessToken
  );
}

async function handleSave() {
  if (saving || !tab || !isValidPageUrl(tab.url)) return;
  saving = true;
  setError("save-error", "");
  $("save-result").classList.add("hidden");
  const btn = $("save-btn");
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    await detectMedia();
    const mediaLinks = detectedMedia.map((item) => ({
      type: item.type,
      url: item.url,
      title: item.title,
    }));
    const res = await collect(mediaLinks);
    if (res.status === 401) {
      await clearAuth();
      show("login");
      setError("login-error", "登录已过期，请重新登录");
      return;
    }
    if (!res.ok) {
      setError("save-error", (res.data && res.data.error) || "保存失败，请稍后重试");
      return;
    }
    renderResult(res.data);
    $("save-btn").textContent = "已保存 ✓";
  } catch {
    setError("save-error", "网络错误，请确认 Organize 服务可访问");
  } finally {
    saving = false;
    btn.disabled = !isValidPageUrl(tab && tab.url);
    if (btn.textContent === "保存中…") btn.textContent = "保存到稍后读";
  }
}

async function handleLogout() {
  await clearAuth();
  show("login");
}

/* ---------------- 初始化 ---------------- */

async function init() {
  $("login-form").addEventListener("submit", handleLogin);
  $("save-btn").addEventListener("click", handleSave);
  $("logout-btn").addEventListener("click", handleLogout);

  await loadAuth();
  if (!auth || !auth.accessToken) {
    $("login-base-url").value = auth && auth.baseUrl ? auth.baseUrl : "http://localhost:3000";
    show("login");
    return;
  }
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  renderMain();
  // 打开即检测媒体（保存时直接附带勾选项）
  await detectMedia();
  renderMediaList();
}

document.addEventListener("DOMContentLoaded", init);
