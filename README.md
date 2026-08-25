# 初一(1)班 · 班主任小台

面向初中班主任的单文件工作台（并行管理学生、班委、家长、班务、座位、值日、成绩、积分、荣誉、谈话、家校沟通、评语等）。

## 技术形态
- 单文件 `index.html`，无需构建，打开即用。
- 数据后端：Supabase（Postgres + Auth + RLS），登录后数据按账号隔离、跨会话持久化。
- 部署：GitHub Pages（本项目），URL 长期稳定。

## 本地目录说明
- `index.html` —— 部署到 GitHub Pages 的正式文件（由工作区 `班主任小台.html` 同步而来）。
- `deploy.sh` —— 改完工作区 `班主任小台.html` 后，运行 `bash deploy.sh` 即可同步并推送到 GitHub。

## 部署与更新
1. 首次部署：仓库根目录的 `index.html` 即站点入口，在仓库 Settings → Pages 选择 `main` 分支、`/ (root)` 目录发布。
2. 后续更新：编辑工作区 `班主任小台.html` → `bash deploy.sh` 同步推送。

## 后端配置（Supabase）
`index.html` 顶部已内置 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY`。
首次使用需在 Supabase SQL Editor 执行 `supabase_schema.sql` 建表（14 张 `hr_*` 表，已开启 RLS 按用户隔离）。
