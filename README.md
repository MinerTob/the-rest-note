# The Rest Note

**The Rest Note** 是一个中英双语的个人网站，记录音乐、技术、实验与日常想法。首页将个人介绍、文章、实验室和联系方式编排成长页，也提供背景音乐、25 键 MiniLab、Web MIDI，以及用 MIDI 与钢琴采样演奏的肖邦《Nocturne Op. 9 No. 2》。

网站使用 Astro 静态生成，浏览器端用原生 TypeScript 和 CSS；没有 React/Vue 等前端框架，也没有运行时数据库。生产环境由轻量 Node 服务提供静态文件、入口重定向和访问会话处理。

## 页面

| 地址 | 内容 |
| --- | --- |
| `/`、`/en/` | 中英文首页 Journey 长页 |
| `/blog/`、`/en/blog/` | 博客列表与标签归档 |
| `/blog/<slug>/`、`/en/blog/<slug>/` | 双语文章 |
| `/lab/`、`/en/lab/` | 实验室项目和 25 键 MiniLab |
| `/about/`、`/en/about/` | 个人介绍、88 键音乐体验 |
| `/about/intro/`、`/en/about/intro/` | 自我介绍长文 |

主要功能：

- `modern` 与 `baroque` 两套主题，各自关联背景曲目。
- 主题音乐记住播放进度、音量和暂停状态；切换主题时，触控设备立即暂停旧曲，桌面端保留交叉淡出。
- About 区通过 PianoEngine、Web Audio 和 MIDI 播放肖邦夜曲；离开 About 后按播放意图恢复背景音乐。
- MiniLab 提供 C4–C6 共 25 个键，支持触控、鼠标、电脑键盘和 Web MIDI。进入 Lab 后预载钢琴采样。
- LCD 地区时钟根据访客 IP 定位城市和时区，并显示当地时间、日期及 UTC 偏移。
- Entry Gate、Astro ClientRouter、中英文切换、RSS 与 sitemap。

## 本地开发

需要 Node.js `>=22.12.0 <25` 和 npm。仓库指定版本见 `.node-version`。

```bash
git clone https://github.com/MinerTob/the-rest-note.git
cd the-rest-note
git lfs install
git lfs pull
npm ci
npm run dev
```

开发服务器默认运行在 `http://localhost:4321`。

常用命令：

```bash
npm test        # 纯逻辑单元测试
npm run check   # Astro / TypeScript 诊断
npm run build   # 生成静态站点到 dist/
npm run preview # 预览 Astro 构建结果
```

如需本地验证生产用 Node 网关，先执行 `npm run build`，再运行：

```bash
npm run start:server
```

网关默认监听 `http://localhost:3000`，也会读取 Render 提供的 `PORT` 环境变量。

## 内容与双语

Markdown 内容位于 `src/content/`：

- `blog/`：文章；同一篇文章用 `名字.zh.md` 和 `名字.en.md` 配对。
- `lab/`：实验室条目；可通过 frontmatter 的 `component: minilab` 挂载键盘。
- `pages/`：About 与 Intro 等页面正文。

文章 frontmatter 示例：

```yaml
---
title: 文章标题
description: 简短摘要
pubDate: 2026-09-27
lang: zh
tags: [Notes]
draft: false
---
```

字段会由 `src/content.config.ts` 校验。界面文案集中在 `src/i18n/ui.ts`；中文使用根路径，英文使用 `/en/` 前缀。

## 音频与媒体

- 主题曲在 `public/music/`，曲目与主题映射在 `src/lib/music.ts`、`src/lib/themes.ts`。
- 钢琴采样表在 `src/lib/piano.ts`；采样加载与播放由 `src/scripts/piano.ts` 管理。
- 肖邦 MIDI 文件位于 `public/music/secret/`。
- 浏览器自动播放受限时，播放器保留用户播放意图，等待真实交互恢复；不会用静音自动播放绕过策略。
- 音频、图像等二进制媒体由 Git LFS 管理。克隆后运行 `git lfs pull`；新增媒体前确认 Git LFS 已安装并检查 `.gitattributes`。

钢琴采样来自 [Salamander Grand Piano](https://sfzinstruments.github.io/piano/salamander)，作者 Alexander Holm，许可为 CC BY 3.0。署名展示在网站页面中。站内音乐版权归各自权利人所有，请勿二次分发。

## 项目结构

```text
src/
├── pages/        Astro 路由
├── views/        页面版式
├── components/   可复用界面组件
├── scripts/      浏览器交互、音乐与 MIDI
├── lib/          纯数据和逻辑
├── i18n/         文案与路径工具
├── styles/       CSS tokens 与全站样式
├── content/      博客、实验室与页面 Markdown
└── tests/        node:test 单元测试
server/           生产环境 Node HTTP 网关
```

维护时请先阅读 [`DEVELOPMENT.md`](./DEVELOPMENT.md)，其中包含功能地图、模块细节、DOM 钩子、存储与事件清单，以及开发日志。项目协作约定见 [`AGENTS.md`](./AGENTS.md)。

## 部署

Render 配置位于 `render.yaml`：

- Build：`npm ci && npm run build`
- Start：`npm run start:server`
- Health check：`/health`

发布前确认 `astro.config.mjs` 中的 `site` 使用正式域名；该值用于 canonical、sitemap 和 RSS 链接。

## 许可证

本仓库代码未附加开源许可证，默认保留所有权利。钢琴采样遵循 CC BY 3.0；其他音乐与媒体请遵守各自权利人的授权要求。
