#!/usr/bin/env bash
# 将工作区最新的「班主任小台.html」同步到 GitHub Pages 仓库根目录并推送。
# 用法：bash deploy.sh "提交说明（可选）"
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
git push
echo "已推送。GitHub Pages 通常 1 分钟内生效。"
