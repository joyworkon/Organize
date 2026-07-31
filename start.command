#!/usr/bin/env bash
# Organize 一键启动脚本（macOS Finder 双击执行）
# 做的事：检查 Docker → 起 Supabase → 写好 .env.local → pnpm dev → 打开浏览器
set -uo pipefail

# ── 让双击时能在 Finder 所在目录运行（macOS 双击 cwd 是 $HOME）──
cd "$(dirname "${BASH_SOURCE[0]}")"

# ── 彩色输出 ──
c_reset="\033[0m"; c_cyan="\033[36m"; c_green="\033[32m"; c_yellow="\033[33m"; c_red="\033[31m"
log()  { echo -e "${c_cyan}▶ $*${c_reset}"; }
ok()   { echo -e "${c_green}✓ $*${c_reset}"; }
warn() { echo -e "${c_yellow}⚠ $*${c_reset}"; }
err()  { echo -e "${c_red}✗ $*${c_reset}"; }

# ── 关闭窗口即终止所有子进程（双击体验：关窗口=全停）──
cleanup() {
  echo
  log "正在停止开发服务器……"
  # 按项目路径精确匹配，杀掉 next dev 及其子进程，避免残留占端口
  pkill -f "Organize/apps/web.*next dev" 2>/dev/null
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null
  rm -f "${OUT:-/tmp/unused}" 2>/dev/null
  ok "已停止 Web 服务器。Supabase 保留在后台（下次启动更快）。"
  echo "💡 如需彻底停后端：终端运行 supabase stop"
  echo "窗口可以关闭了。"
}
trap cleanup EXIT INT TERM

# ── 0. 检查工具链 ──
command -v pnpm     >/dev/null || { err "未找到 pnpm。请先安装：brew install pnpm"; read -n1 -r -p "按任意键关闭…"; exit 1; }
command -v supabase >/dev/null || { err "未找到 supabase CLI。请先安装：brew install supabase/tap/supabase"; read -n1 -r -p "按任意键关闭…"; exit 1; }

# ── 1. Docker：没开就自动打开并等待 ──
log "检查 Docker…"
if ! docker info >/dev/null 2>&1; then
  if [[ -x "/Applications/Docker.app" ]]; then
    warn "Docker 未运行，正在打开 Docker Desktop…"
    open -a Docker
    # 最长等 90 秒
    for i in {1..90}; do
      docker info >/dev/null 2>&1 && break
      sleep 1
      printf "\r  等待 Docker 启动… %2ds/90s" "$i"
    done
    echo
    docker info >/dev/null 2>&1 || { err "Docker 90 秒内未就绪，请手动打开 Docker 后重试。"; read -n1 -r -p "按任意键关闭…"; exit 1; }
  else
    err "未检测到 Docker。请先安装 Docker Desktop: https://docker.com"
    read -n1 -r -p "按任意键关闭…"; exit 1
  fi
fi
ok "Docker 就绪"

# ── 2. Supabase：没起就 start ──
log "检查 Supabase…"
if supabase status >/dev/null 2>&1 | grep -q "running"; then :; fi
# supabase status 在已运行时返回 0，未运行返回非 0，用它判断最稳
if ! supabase status >/dev/null 2>&1; then
  warn "Supabase 未运行，正在启动（首次约 1–2 分钟）…"
  supabase start || { err "Supabase 启动失败。"; read -n1 -r -p "按任意键关闭…"; exit 1; }
else
  ok "Supabase 已在运行"
fi

# ── 3. .env.local：不存在则用本地默认 anon key 生成 ──
ENV_FILE="apps/web/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  warn "$ENV_FILE 不存在，正在用本地默认值生成…"
  # 这是 supabase start 后固定的本地 demo anon key（JWT），所有本地项目通用
  ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
  {
    echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY"
  } > "$ENV_FILE"
  ok "已生成 $ENV_FILE"
else
  ok "$ENV_FILE 已存在"
fi

# ── 4. 依赖：node_modules 不在就装 ──
if [[ ! -d "node_modules" ]]; then
  log "安装依赖（pnpm install）…"
  pnpm install || { err "依赖安装失败。"; read -n1 -r -p "按任意键关闭…"; exit 1; }
fi

# ── 5. 启动 Web 开发服务器 ──
log "启动 Web 开发服务器…"
# 后台跑，把输出存到临时文件，我们边等边从输出里抓实际端口
# 注意：不要用子 shell () 包裹，否则 WEB_PID 无法传到当前 shell，trap 里 kill 不到
OUT="$(mktemp -t organize-dev)"
pnpm --filter @organize/web dev >"$OUT" 2>&1 &
WEB_PID=$!

# 找一个可用端口（Next 会在 3000 起被占就往上加）
URL=""
for i in {1..60}; do
  sleep 1
  # 输出里形如 "- Local: http://localhost:3002"
  LINE="$(grep -Eo 'http://localhost:[0-9]+' "$OUT" | head -1)"
  if [[ -n "$LINE" ]]; then
    URL="$LINE"
    # 再确认端口真能连上
    if curl -s -o /dev/null "$URL"; then break; fi
  fi
done

if [[ -z "$URL" ]]; then
  err "60 秒内未检测到开发服务器，原始日志："
  tail -30 "$OUT"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi
ok "开发服务器已就绪：$URL"

# ── 6. 打开浏览器 ──
log "打开浏览器…"
sleep 1
open "$URL"

echo
ok "🎉 启动完成！"
echo
echo "   Web:      $URL"
echo "   Supabase: http://127.0.0.1:54321   (API)"
echo "   Studio:   http://127.0.0.1:54323   (数据库管理界面)"
echo
echo "💡 关闭此窗口即停止 Web 服务器。Supabase 会保留在后台，下次启动更快。"
echo "   如需彻底停后端：终端运行 supabase stop"
echo
echo "── 开发服务器日志（实时）────────────────────────"
# 把后台日志接力输出到当前终端，直到用户 Ctrl+C 或关窗
tail -f "$OUT" 2>/dev/null
