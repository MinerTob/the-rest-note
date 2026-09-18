# The Rest Note · 个人数字空间

> 在生活的旋律之间，留一拍安静给自己。

一个渐变 + 液态玻璃（Liquid Glass）+ LCD 数字质感的个人站点：表面上是安静简约的博客，里面藏着音乐、一台 25 键小乐器，和需要自己发现的机关。

用 [Astro](https://astro.build) 构建，中英双语，整站静态输出，没有前端框架，没有运行时数据库，`dist/` 丢到任意静态托管就能跑。

`Astro 7` · `TypeScript` · `Web Audio API` · `Web MIDI API` · `CSS backdrop-filter` · `Git LFS`

> **开发文档在 [`DEVELOPMENT.md`](./DEVELOPMENT.md)**：功能地图（功能 → 文件 → 函数）、模块详解、DOM 钩子、存储与事件总表，以及按天记录的功能日志。
> 新增或修改功能后，记得在它的 §10 功能日志里追加一条。
> 本仓库的协作约定写在 [`AGENTS.md`](./AGENTS.md)。

---

## 目录

- [功能一览](#功能一览)
- [技术栈](#技术栈)
- [启动 / 构建](#启动--构建)
- [部署](#部署)
- [目录结构](#目录结构)
- [写内容](#写内容)
- [双语是怎么工作的](#双语是怎么工作的)
- [音频](#音频)
- [MiniLab 与机关](#minilab-与机关)
- [首页的构成](#首页的构成)
- [About：88 键音乐体验](#about88-键音乐体验)
- [状态与主题](#状态与主题)
- [设计约定](#设计约定)
- [SEO 与无障碍](#seo-与无障碍)
- [仓库与 Git LFS](#仓库与-git-lfs)
- [许可与署名](#许可与署名)

## 功能一览

| 功能 | 在哪 | 说明 |
| --- | --- | --- |
| 双语博客 | `/blog/`、`/en/blog/` | 中英各一份 Markdown，靠文件名后缀配对 |
| 标签归档 | `/blog/tags/[tag]/` | 两种语言各一套 |
| 首页 | `/`、`/en/` | 左列内容（身份 → 最近 → 联系我），右列仪表（LOCAL TIME → MUSIC SYSTEM → LAB） |
| 实验室 | `/lab/`、`/en/lab/` | 条目页；`component: minilab` 会在条目下渲染小乐器 |
| 关于 | `/about/`、`/en/about/` | 88 键瀑布流 + MIDI 夜曲 + 十个身份标签 |
| 自我介绍 | `/about/intro/`、`/en/about/intro/` | 关于页第十个标签点进来的长文页；中英各一篇，续播同一首夜曲，左上角"返回"回到首页那串页面里的关于区（`#about`） |
| 背景音乐 | 全局 | 淡入淡出、交叉淡入淡出、静音 / 暂停，音量与状态记忆 |
| MiniLab | `/lab/#minilab` | 25 键（C4–C6）；鼠标 / 触摸 / 电脑键盘 / `Tab`+方向键 / Web MIDI |
| 机关（彩蛋） | MiniLab | 提示模式里弹对旋律 → 换主题 + 换曲 + 解锁隐藏曲目 |
| 主题系统 | 右下角开关 | `modern` / `baroque` 两套，改一个 `<html>` 属性，不重新渲染 |
| 语言切换 | 右上角 `ZH / EN` | 跳到同一页的另一种语言；**只有文字动**：旧的向左滑出、新的从右滑入；切完停在原处——正在看的那一块按屏幕里的地标对齐（内容高度变了也不跑），关于页那十个标签留在原来的落点 |
| 系统提示 | 左下角 LCD | 复制、状态变更等的轻量反馈，不弹窗 |
| RSS / sitemap | `/rss.xml`、`/en/rss.xml` | `@astrojs/rss` + `@astrojs/sitemap` |
| 无障碍 | 全局 | skip link、`aria-label`、focus 圈只在键盘操作时出现（鼠标玩家看不到蓝框）、不靠颜色单独表达状态、尊重 `prefers-reduced-motion` |

## 技术栈

| 层 | 用了什么 |
| --- | --- |
| 框架 | Astro 7（默认静态输出，`ClientRouter` 做站内客户端路由） |
| 语言 | TypeScript（`astro check` 零错误） |
| 样式 | 原生 CSS：`tokens.css`（语义令牌 + 主题）+ `global.css` + `home-glass.css`，无预处理器、无 Tailwind |
| 声音 | Web Audio API（`AudioContext` + `playbackRate` 移调）、`<audio>` 元素 |
| 输入 | Web MIDI API、Pointer Events、键盘事件 |
| 物理 | `matter-js`（About 页身份标签的落地回弹） |
| 内容 | Astro Content Collections（`src/content/**`，`zod` 校验） |
| 测试 | `node --test`（纯逻辑单测，不跑浏览器） |
| 大文件 | Git LFS（音频 / 图片 / 视频 / 压缩包） |

没有 React / Vue / Svelte，没有 CSS 框架，没有后端。交互全部是「需要时加载的原生 TS」：组件只输出 HTML 和 `data-*` 钩子，`src/scripts/` 里的代码在客户端接管。

## 启动 / 构建

```bash
npm install       # 第一次先装依赖
npm run dev       # 开发服务器 → http://localhost:4321
```

开发服务器启动后，浏览器打开 **http://localhost:4321** 即可。

其他命令：

```bash
npm run build     # 构建静态站点到 dist/
npm run preview   # 预览 dist/ 里的构建结果
npm run check     # Astro 类型 / 模板诊断
npm test          # 纯逻辑单元测试（音名映射、旋律识别、主题与曲目映射、音量渐变、联系方式与身份标签）
```

停止开发服务器：在项目目录执行 `npx astro dev stop`（或直接 Ctrl+C 掉那个终端）。

需要 Node 18 以上（开发环境使用 Node 22）。`npm test` 用的是 Node 的类型剥离参数 `--experimental-strip-types`，所以 Node 版本不能太老。

> 仓库用 Git LFS 存音频。克隆之后如果 `public/audio/piano/*.mp3` 是几十字节的文本指针，先跑一次 `git lfs pull`。

## 部署

### 部署前要改的地方

| 位置 | 当前值 | 说明 |
| --- | --- | --- |
| `astro.config.mjs` → `site` | `https://example.com` | 换成你的正式域名 |
| `src/lib/site.ts` → `SITE.url` | `https://example.com` | 与上一行保持一致 |
| `src/lib/site.ts` → `SITE.name` / `SITE.mark` | `The Rest Note` / `RN` | 站点名与左上角标识 |
| `src/lib/site.ts` → `NAV` | 首页 / 文章 / 实验室 / 关于 / GitHub | 导航项；`external: true` 的在新标签页打开 |
| `src/lib/site.ts` → `SITE.location` | 新加坡 UTC+08:00 | 首页 LCD 时钟的时区 |

`site` 会影响 canonical、Open Graph、RSS 与 sitemap，改完记得重新构建。

### 静态托管

`dist/` 是纯静态目录，可以直接丢到 GitHub Pages、Cloudflare Pages、Netlify 或任意静态托管：

| 托管 | 构建设置 |
| --- | --- |
| Cloudflare Pages | build command `npm run build`，输出目录 `dist` |
| Netlify | 同上，`dist` |
| Render | Static Site：build command `npm ci && npm run build`，publish directory `dist` |
| GitHub Pages | 需要把产物发到 Pages 分支或用 Action；`site` 要填对，否则子路径部署时资源会 404 |
| 自己的服务器 | 把 `dist/` 拷过去即可，无需 Node 运行时 |

> **Node 版本是硬性要求。** Astro 7 需要 **Node ≥ 22.12.0**：仓库根目录的 `.node-version`（`22.22.0`）和 `package.json` 里的 `engines` 都写了这一点。托管平台如果默认给更老的 Node（Render 上，2024 年创建的服务默认是 20.15.1），构建会在 `astro build` 那一步直接拒绝运行，报 `Node.js vX is not supported by Astro!`。平台设置里找不到 Node 版本选项时，加一个环境变量 `NODE_VERSION=22.22.0` 即可（Render 的优先级是 `NODE_VERSION` > `.node-version` > `.nvmrc` > `engines`）。

站点没有任何服务端逻辑，也不需要 `.env` —— 唯一可能用到的环境变量就是上面那个 `NODE_VERSION`。

## 目录结构

```
src/
├── content/            # 内容（Markdown）
│   ├── blog/           # 文章，中英各一份文件
│   ├── lab/            # 实验室条目
│   └── pages/          # about 等单页
├── components/         # Header / Footer / LcdClock / MusicSystem / MiniLab / SystemMessage ...
├── views/              # 页面级版式（被 pages 里的路由复用，两种语言共用）
├── pages/              # 路由：中文在根路径，英文在 /en/*
├── layouts/            # BaseLayout（head、header、footer、客户端入口）
├── i18n/               # ui.ts 字典 + utils.ts 工具
├── lib/                # 站点信息、内容查询、音乐、钢琴采样表、彩蛋、联系方式、身份标签
├── scripts/            # 只在需要交互时才加载的客户端代码
└── styles/             # tokens.css（设计令牌）+ global.css + home-glass.css

public/
├── favicon.svg
├── icons/contact/      # 联系方式的图标（含来源与授权说明）
├── music/              # 背景音乐（浏览器通过 /music/xxx.mp3 访问）
│   └── secret/         # 隐藏曲目 + About 页的 MIDI 乐谱
└── audio/piano/        # MiniLab / About 用的钢琴采样

tests/                  # node --test 单元测试
.node-version           # 声明 Node 版本（托管平台用它选版本，务必 ≥ 22.12.0）
.gitattributes          # Git LFS 规则 + 换行符规则
DEVELOPMENT.md          # 开发文档（功能地图 / 模块详解 / 功能日志）
AGENTS.md               # 给 AI 助手的协作约定
```

## 写内容

每篇内容都有两个文件，靠文件名后缀配对：

```
src/content/blog/audio-system.zh.md
src/content/blog/audio-system.en.md
```

frontmatter 里的 `lang` 必须和文件后缀一致。两边的文件名相同，语言切换时才能停在「同一篇」上；如果只写了一种语言，切到另一种语言会回到列表页。

Blog 的 frontmatter：`title` / `description` / `pubDate` / `updatedDate?` / `lang` / `tags[]` / `draft`。
Lab 还支持 `order`（排序）、`status`（状态灯颜色）；`component: minilab` 会在该条目下面渲染那台小乐器。
单篇长文页（关于 / 自我介绍）放在 `src/content/pages/`：`about.zh.md` / `about.en.md` 给 About 页侧栏，`intro.zh.md` / `intro.en.md` 给 `/about/intro/`。正文里的 `##` 就是"加大加粗"的小标题，别再加装饰线。

## 双语是怎么工作的

- 路由：中文在根路径（`/blog/`），英文加前缀（`/en/blog/`），由 `astro.config.mjs` 的 `i18n` 配置决定。
- 文案：导航、按钮、状态等 UI 文案来自 `src/i18n/ui.ts` 的字典，组件用 `<T k="..." lang={lang} />` 输出，会同时带上 `data-zh` / `data-en`。
- 切换：点右上角 `ZH / EN` 会直接跳到**当前页面对应的另一种语言地址**（文章会跳到同一篇的译文），并把这个选择记在 `localStorage`。
- 切换动画：只有文字动 —— 旧语言的文字向左滑出，新语言的文字从右滑入；页面骨架、玻璃卡片和背景原地不动，也不会重播入场动画。实现在 `src/scripts/lang.ts`，是唯一的语言切换动画，不要再往里加整页级别的过渡。
- 切换后停在原处：换页前先记下「你正在看的那一块」（地标，长文页取视线高度那一段）+ 滚动位置（含 `#锚点`），换页后按地标对齐 —— 英文普遍更长（实测首页整块区域下沉 115px），只按老像素回去会让人正在看的东西被挤走。关于页那十个标签的落点也保留，并按区块位移整体平移，不重抛、不提前弹出。换页时 ClientRouter 会先滚回顶部，`lang.ts` 把它接回来，并留一个一次性记号告诉新页面「这一趟只是换语言」。
- 两个语言共用同一套页面代码，不存在两份 HTML 模板。

## 音频

浏览器只认 `public/` 下的路径，代码里永远不要写本地盘符路径。

| 文件 | 用途 | 是否需要自己放 |
| --- | --- | --- |
| `public/music/dao-xiang.mp3` | 默认背景音乐 | 已经在仓库里 |
| `public/music/secret/canon.mp3` | 隐藏曲目（机关触发后播放） | 已经在仓库里 |
| `public/music/secret/f-chopin-nocturne-op9-no2-in-e-flat-major.mid` | About 页 88 键演奏的乐谱 | 已经在仓库里 |
| `public/audio/piano/*.mp3` | 钢琴采样，30 个音 | 已经在仓库里 |

隐藏曲目的文件不存在时，切换会**静默失败**：当前音乐继续播放，不会报错、不会出现破音或空白。放进去之后不用改任何代码。

### 背景音乐（Music Manager）

音频文件放在 `public/music/`，浏览器按 `/music/xxx.mp3` 取用。

加一首新曲子：编辑 `src/lib/music.ts` 的 `TRACKS`，加一条 `{ id, title, subtitle, src }`；不想让它出现在列表里就标记 `hidden: true`（隐藏曲目只作为彩蛋目标使用）。

行为约定（都在 `AUDIO` 常量里）：默认音量 0.3、淡入 2.4s、淡出 1.2s、交叉淡入淡出 2s。浏览器禁止自动播放时不会强播，而是安静地停在 `READY`，等用户第一次点击/按键后再启动。音量、静音与暂停状态会记在 `localStorage`。

**换主题一定会出声。** 换主题是一次明确的用户动作，等于「我要听这套主题的音乐」，所以 `crossfadeTo(id, { force: true })` 会清掉之前的暂停，把新曲目真的放出来 —— 而不是只把播放器上的名字换掉。这条对两个入口都成立：右下角的主题开关，以及彩蛋触发。否则会出现「界面已经切到 Baroque、canon 却不出声」这种假切换。

反过来说，用户手动按暂停之后不会再自动出声，除非他主动换一次主题。

音量渐变用 `requestAnimationFrame` 跑，进度两头都夹在 [0, 1]（`clamp01` / `volumeAt`，在 `src/lib/music.ts` 里，有单元测试）：rAF 回调拿到的时间戳有可能早于渐变记下的起点，负进度会让缓动反向过冲，算出 -0.003 这种音量；给 `HTMLMediaElement.volume` 赋越界值会抛 `IndexSizeError`，整条淡入当场断在半路 —— 听感就是「曲目切过去了，却没有声音」。另外每首曲子只建一个 `<audio>` 并留着，切回去时文件已经缓冲好，不用重新下载，也不会卡在等 `canplay` 上；快速连续切换时只有最后一次生效，被打断的那次直接作废。

如果目标文件放不出来（文件缺失 / 解码失败），切换会静默失败：当前音乐继续播，并且播放器会 `syncState()` 回到**真正在放的那首** —— 播放器永远不会显示一首其实没在放的曲子。

### 钢琴采样（Piano Sound Engine）

`src/lib/piano.ts` 列出采样表，`src/scripts/piano.ts` 负责按需加载与发声。只有 30 个 mp3（约 1.9 MB），不是完整 88 键采样：按下的音会找最近的采样，再用 `playbackRate` 移调补齐中间的音。

MiniLab 只用得到 C4–C6（25 键），所以页面加载时不会预载全部采样 —— 用户第一次碰琴键时才创建 `AudioContext` 并开始加载。

> **署名要求**：采自 [Salamander Grand Piano](https://sfzinstruments.github.io/piano/salamander)（Alexander Holm），授权 **CC BY 3.0**。这个授权要求署名，所以署名已经写在 MiniLab 页脚和 About 页侧栏里。如果换成别的音源，记得同步换掉这两处，并核对新音源的授权。

## MiniLab 与机关

分层很清楚，加新东西不需要动 UI：

```
MiniLab（产生音符）
  └─ minilab:note 事件
       └─ Sequence Detector（src/lib/sequences.ts，识别旋律）
            └─ Easter Egg Manager（src/scripts/easter-eggs.ts，决定触发什么）
                 ├─ Theme Manager（src/scripts/theme.ts，整体换主题）
                 └─ Music Manager（src/scripts/music-manager.ts，换曲 / 淡入淡出）
```

MiniLab 是固定 25 键（C4–C6），支持鼠标、触摸（含按住滑动）、`Z`–`M` / `Q`–`I` 电脑键盘、`Tab` + 方向键，以及通过 Web MIDI 接入的真实 MIDI 键盘。它只做一件事：把按下的音变成事件，它不认识机关。

所有机关都写在 `src/lib/easter-eggs.ts` 的 `EASTER_EGGS` 数组里：旋律、时间窗口、提示文案、完成后解锁哪首曲子（`unlocks`）和切到哪套主题（`resultTheme`）都在同一条记录里。想加第二个旋律，往数组里加一条就行 —— MiniLab 不用改。

每条机关都**绑定一套主题**：`modern` 下只存在解锁那条，`baroque` 下只存在返回那条。提示模式按当前主题挑一条，所以同一个入口在两套主题里提示的是不同的旋律。

**旋律判定只在提示模式里运行。** 平时弹琴（鼠标 / 触摸 / 电脑键盘 / MIDI）只发出声音，Sequence Detector 根本不参与 —— 不按入口键、把整条旋律原样弹一遍，也不会有任何反应。

提示模式的入口是 MiniLab 页面上的一组按键（具体是什么键看 `src/scripts/easter-eggs.ts`）。进入后**一次只点亮一个目标琴键**：按对 → 当前键变成 ACCEPTED、下一个亮起；按错 → 只是当前提示很轻地闪一下，不弹窗、不重置页面、不显示 WRONG。全程不显示完整序列、不显示进度数字、不暗示下一个音。

提示高亮用的是主题自己的颜色（`--key-hint-*`），所以切到木质主题时提示会自然变成暖色，不会留下一块蓝。

序列走完时会切主题（`ThemeManager`）并按新的 Theme Profile 换曲（`MusicManager`）。整个过程只改 DOM 属性与状态：不刷新、不跳转、不改滚动位置。

> 注意：这个文件里写着旋律本身。如果仓库是公开的，机关就等于写在明处了 —— 这是纯前端彩蛋的固有代价。请不要把这个答案再抄到页面文案、console 提示或 README 里。

## 首页的构成

首页不是「Hero → 卡片 → 卡片」，而是两列各自流动：左列是内容（身份 → 最近 → 联系我），右列是仪表（LOCAL TIME → MUSIC SYSTEM → LAB）。窄屏拆成单列后按这个顺序重排：身份 → 时间 → 最近 → 联系我 → 音乐 → 实验室。

「联系我」是首页的一个正式分区，不是页脚。四种联系方式，一个很轻的玻璃面，行与行之间**没有分隔线** —— 分组靠间距和 hover 时浮起来的那层薄面。它必须是首页里最轻的一块。

数据在 `src/lib/contact.ts`，只放本人给过的四条，不补全、不猜测：

| 通道 | 值 | 点击 |
| --- | --- | --- |
| WeChat | `MinerTob_Unearthing` | 复制账号 |
| Email | `minertob114@gmail.com` | `mailto:` 打开邮件客户端；右侧单独一格可复制 |
| Bilibili | `@MinerTob` | 站外链接 `space.bilibili.com/1778966676/`，新标签页打开（`rel="noopener noreferrer"`） |
| X | `@wei_yan95742` | 站外链接，新标签页打开（`rel="noopener noreferrer"`） |

- 只有 `href` 的行整行是链接，只有 `copy` 的行整行是按钮；两者都有时行主体走 `href`，右侧另给一个复制入口。
- 复制反馈只有两处：行内把 `COPY` 换成 `COPIED`（1.2 秒），以及左下角 LCD 系统提示里写一句复制的是什么。没有弹窗。两处文案都从 DOM 里读，所以自动跟着语言走。
- 复制先试 Clipboard API，不成退回隐藏 textarea + `execCommand`；两条路都不通时**不做任何成功反馈** —— 说「已复制」是句谎话。

## About：88 键音乐体验

`src/components/IdentityStage.astro` + `src/scripts/identity-player.ts` 展示 A0–C8 的 88 键瀑布流。进入 About 后自动接入现有 Salamander / PianoEngine 采样演奏；首次访问被浏览器阻止自动播放时，在第一次点击或按键后接入。离开 About 恢复当前主题音乐；About 内暂停时保持安静。

乐谱为 `public/music/secret/f-chopin-nocturne-op9-no2-in-e-flat-major.mid`。其 480 PPQ、1/8 弱起加四个 12/8 完整小节，对应 tick 11760，按原始变速表积分为 33.464427875 秒。十个标签在此之前全部落定，整首继续并循环；循环保留标签，重新开始按钮才重新展示标签动画。

MIDI 音符的 `release` / `releaseTick` 是按键释放时间，供音条长度和琴键高亮使用；`end` / `endTick` 包含 CC64 踏板延音，只供发声调度使用。不能将踏板时长画进音条。

About 只展示 88 键介绍与版权页脚。夜曲与每首主题曲各有独立的实时循环时钟（`src/lib/live-timeline.ts`），在当前标签页的 `sessionStorage` 中保留：离开、暂停或刷新不会重置计时，重新接入按已流逝时间定位；只有「重新开始」会显式重置夜曲。返回时已过触发时间的个性标签直接呈现。隐藏页面时停止 MIDI 发声，恢复可见时接入实时位置。切语言的例外：那是「同一页换种说法」，已经在场上的标签从原位置继续参与物理运动、不重新抛一遍，还没上场的继续按乐谱排队 —— 音乐走到那一颗音才放出来，不会提前补齐（`src/scripts/lang.ts` 的 `takeLanguageSwap()` + `identity-physics.ts` 的 `markPlaced()`）。

数据与规格：

- 标签数据在 `src/lib/identity.ts`：`{ id, zh, en }`，中英各一份。`ANALYTICAL` 指的是拆解问题、找规律，不是「小心谨慎」，翻中文时别写成「细心」。
- 第十个标签（`intro`）比别的大 0.2 倍，点一下进 `/about/intro/`；拖动抛出不会误触发（按下后位移 < 8px、0.7 秒内抬手才算点击）。放大只能改 font-size / padding，`transform: scale()` 会被物理引擎每帧覆盖。
- 自我介绍页：`src/views/IntroPage.astro` + `src/content/pages/intro.zh.md` / `intro.en.md`（15 个小节，`##` = 加大加粗的标题）。这一页跟 About 共用同一首夜曲的实时位置，两边互相「接着放」；左上角有返回按钮（中文只写`返回`）。
- 动画规格在 `IDENTITY_MOTION`：弹出 → 飞行 → 落地 → 回弹的时长、弧线高度、旋转上限。测试给这组数字兜底 —— 调过头就变成小游戏了。
- MIDI 映射在 `src/lib/identity-midi.ts`，`tests/identity-midi.test.mjs` 会挡住不合法的值。
- DOM 钩子是 `data-identity` / `data-identity-state` / `data-identity-tag` / `--i`，改名之前先看 `DEVELOPMENT.md` §7 的 DOM 钩子总表。

## 状态与主题

### Application State

全站只有一份状态，在 `src/scripts/app-state.ts` 的 `AppStore` 里：

```
theme            当前主题
currentTrack     当前真正在放的曲目
unlockedTracks   已经解锁的隐藏曲目
hintMode         是否在隐藏提示模式
eggActive        机关是否刚刚被触发
```

谁要改状态，谁就调用 `store.set()`；改完派发一个 `change` 事件，UI 各自跟上。这样有两个直接好处：

- **一次写入里的东西永远一起变。** 换主题时 `theme` 和 `currentTrack` 是同一次 `set()` 写进去的，不可能出现「界面回到 modern、音乐还在放 canon」这种撕裂状态。
- **落盘只有一个地方。** `theme` 与 `unlockedTracks` 写 `localStorage`；`hintMode` / `eggActive` 只是这一段浏览里的事，不落盘。

### Theme Profile

主题不只决定颜色，也决定「这个空间里在放什么」：

```ts
// src/lib/themes.ts
THEME_TRACK = { modern: 'dao-xiang', baroque: 'canon' }
```

曲目由当前主题推导出来，不是独立状态 —— 所以刷新之后它们永远一致。加第三套主题要动两处：`tokens.css` 里加一组选择器，`src/lib/themes.ts` 里加一条。

### 主题切换

主题完全由 `<html data-theme="...">` 决定，颜色、渐变、玻璃、LCD、纸张全部写在 `src/styles/tokens.css` 的两组选择器里：

```
:root                      → 默认主题（无 JS 时也是它）
html[data-theme='...']     → 其它主题
```

切换主题 = 改一个属性，不需要重新渲染页面，也不需要改任何组件。组件**只允许使用语义 token**，不要在组件里写死颜色，否则换主题时会有东西掉队。

`src/scripts/theme.ts` 是 `ThemeManager`：`setTheme(name, { animate?, persist? })` / `toggle()`。首次绘制前 `BaseHead.astro` 里有一段内联脚本先把已保存的主题写到 `<html>` 上，避免闪一下。

过渡是一层 `.ambient-ghost`：把旧背景复制成固定层盖在新背景上淡出（`FADE_MS` ≈ 640ms），同时给 `<html>` 挂同样时长的 `.theme-shift` 让颜色一起补间。没有闪白、没有 loading、没有重新加载。

**换页不会把主题弄丢。** 站内导航走的是 Astro 的客户端路由（`ClientRouter`），它换页时会用新文档的 `<html>` 属性覆盖当前这份 —— 而服务端渲染出来的 `<html>` 上没有 `data-theme`（它属于访客，不属于页面），于是这个属性会被抹掉，主题看着退回默认值，状态里却还是 baroque。所以有两道保险：`app.ts` 在 `astro:before-swap` 时把当前主题写进即将替换上来的那份文档（换页瞬间就生效，过渡里不会闪回默认主题），`initTheme()` 每次 boot 再补写一次。

### 解锁之后的主题开关

右下角那个小椭圆玻璃控件（`ThemeSwitcher.astro`）**只在解锁过至少一首隐藏曲目之后才存在**；没解锁时它连位置都不占。它自己不存状态：显示什么、点了做什么，全从 `AppStore` 读。点一下就是在 `modern ↔ baroque` 之间切换，音乐跟着主题走。

它的配色刻意不用页面主色，而是单独的 `--ctrl-*` 一组令牌（中性银 / 香槟金；木质主题下是黄铜），看起来像一枚实体控制器，而不是又一个 UI 按钮。

## 设计约定

- 视觉语言：**渐变是主角，玻璃是材质，LCD 是细节**。白色只是环境的浅色基底，不是主视觉。
- 环境背景是 `.ambient` 里的一层固定渐变 + 几片低饱和**冷色**场（冰蓝 / 青 / 蓝），只有很少一点蓝紫当环境光。不要蓝→紫→粉那种彩虹渐变，紫色不是主色。纹理是很弱的噪点（`--bg-texture`），**不要网格线**。
- 线条只留在真正承担分组的地方（表格、列表项之间、正文与脚注之间）。纯装饰的横线、分隔线、网格线一律删掉 —— 标题靠留白分级，不靠线。
- 颜色、圆角、模糊、阴影、动效时长、琴键配色都在 `src/styles/tokens.css`；改主题优先改这里。
- 深色只出现在 LCD 屏（时钟、MiniLab 屏、系统提示）上，用来当「设备」而不是当背景。
- 正文优先可读：正文永远落在 `.sheet`（纸面）上，玻璃、渐变、发光都不会影响阅读。玻璃只用在导航、metadata、目录、代码块这类辅助层上。
- 动画轻量，并且全局尊重 `prefers-reduced-motion`（变量归零，等于关掉动效）。
- 交互动画只动该动的东西：换语言只动文字，换主题只动颜色和背景，换页不重播入场动画。
- 交互组件都有 `aria-label`、可见 focus 状态，并且不靠颜色单独表达状态。

## SEO 与无障碍

每页都有 title、meta description、canonical、`hreflang`、Open Graph / Twitter 卡片、`theme-color`；另有 `@astrojs/sitemap` 生成的 sitemap 和两种语言各自的 `/rss.xml`、`/en/rss.xml`。语义化标签、跳过导航链接（skip link）、键盘可达性都已处理。

## 仓库与 Git LFS

仓库地址：<https://github.com/MinerTob/the-rest-note>

仓库用 **Git LFS** 管理媒体大文件，规则写在 `.gitattributes`：

```
*.mp3 *.wav *.flac *.m4a *.ogg *.aac                              # 音频
*.mp4 *.webm *.mov *.mkv                                          # 视频
*.png *.jpg *.jpeg *.gif *.webp *.avif *.ico *.bmp *.psd          # 位图
*.zip *.7z *.rar                                                  # 压缩包
```

SVG 图标**不**走 LFS：它们是纯文本，留在普通 Git 里才能 diff 和 review。新增音频/图片时按上面的后缀走，不用改规则。

克隆与更新：

```bash
git lfs install          # 每台机器只需一次
git clone <repo-url>
git lfs pull             # 没自动拉下来的话
```

新增媒体文件的注意事项：

- 先确认 `git lfs install` 跑过，再把文件放进 `public/`，然后 `git add` —— 否则会当成普通文件提交进历史，之后再改要重写历史，很麻烦。
- 改完用 `git lfs ls-files` 核对一遍，列表里应该有你刚加的文件。
- `node_modules/`、`dist/`、`.astro/`、`.codegraph/`、`.env*`、日志和浏览器 profile 都在 `.gitignore` 里，不要提交。
- 浏览器缓存、LFS 带宽都是要花钱的，别把测试用的临时音频留在仓库里。

提交信息用中文短句写清楚做了什么；改动如果影响功能，同步更新 `DEVELOPMENT.md` §10 的功能日志。

## 许可与署名

- **代码**：本仓库没有附加开源许可证，默认保留所有权利。想拿去用请先问一声。
- **钢琴采样**：采自 [Salamander Grand Piano](https://sfzinstruments.github.io/piano/salamander)（Alexander Holm），授权 **CC BY 3.0**，署名已写在 MiniLab 页脚和 About 页侧栏。
- **联系图标**：来源与授权见 `public/icons/contact/SOURCES.md`（含 Lucide 与 Simple Icons 的许可证副本）。
- **音乐**：`public/music/` 下的曲目版权归各自权利人所有，仅作个人站点展示使用，不要二次分发。
