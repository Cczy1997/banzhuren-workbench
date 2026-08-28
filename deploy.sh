#!/usr/bin/env bash
# 将工作区最新的「班主任小台.html」同步到 GitHub Pages 仓库根目录并推送。
# 用法：bash deploy.sh "提交说明（可选）"
#
# 推送策略：
# 1. 先尝试 git push（走本地 https_proxy，可能在 GFW 场景下被劫持/限速）
# 2. 失败时自动回退到 deploy/_push_via_api.py —— 走 GitHub Data API + curl
#    （后者走本机代理层仍可建立 HTTPS CONNECT，可绕过 git 包传输受限问题）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/班主任小台.html"
DST="$ROOT/gh-pages/index.html"
MSG="${1:-更新班主任小台}"

if [ ! -f "$SRC" ]; then
  echo "未找到源文件：$SRC" >&2
  exit 1
fi

cp "$SRC" "$DST"
cd "$ROOT/gh-pages"
git add -A
git commit -m "$MSG" || echo "（无变更，跳过提交）"

PUSH_OUT=$(git push origin main 2>&1) || PUSH_RC=$?
PUSH_RC=${PUSH_RC:-0}
if [ "$PUSH_RC" -eq 0 ]; then
  echo "已通过 git push 推送。GitHub Pages 通常 1 分钟内生效。"
  exit 0
fi

echo "[deploy.sh] git push 失败 (rc=$PUSH_RC)。尝试走 GitHub Data API 回退推送..."
echo "$PUSH_OUT" | tail -5
if ! command -v python3 >/dev/null; then
  echo "需要 python3 才能走 API 回退路径，请手动重试 git push。" >&2
  exit "$PUSH_RC"
fi
python3 "$ROOT/deploy/_push_via_api.py"
echo "已通过 API 推送。GitHub Pages 通常 1 分钟内生效。"
