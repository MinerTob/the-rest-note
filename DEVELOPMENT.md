# 开发文档 · The Rest Note

> 这份文档是项目的**功能地图**，写给未来的维护者 —— 人和 AI 都算。
> 它不介绍"成品长什么样"，只回答三个问题：
> 1. **这个功能在哪个文件里？** → §3 功能地图
> 2. **它是怎么工作的、要改哪里？** → §5 模块详解
> 3. **改完之后还要做什么？** → §9 检查清单 + §10 功能日志
>
> **硬性规矩：每加一个新功能 / 改一个已有功能，都要先在 §3 找到它，改完在 §10 功能日志追加一条。**
> 动了导出函数、DOM 钩子、存储 key、自定义事件，就同步改 §6 / §7 的表格。没写日志的改动视为没完成。

---

## 0. 怎么用这份文档（给 AI 的检索建议）

- 找功能：直接搜 §3 的中文功能名，或搜组件上的 `data-*` 钩子（§7 有全量清单）。
- 找函数：`rg -n "函数名" src`。本项目所有可复用逻辑都用 `export function` / `export class` 声明。
- 追一条链路：§3 找到入口组件 → 看组件里的 `data-*` → 找到读取它的 `init*()` 脚本 → 看 §5 对应小节。
- 不要假设框架：这是 **纯 Astro + 原生 TypeScript**，没有 React/Vue/Svelte，没有状态库，没有构建期之外的模板渲染。

---

## 1. 项目速览

| 项 | 内容 |
| --- | --- |
| 定位 | 个人数字空间：音乐 / 技术 / 实验 / 记录 |
| 技术栈 | Astro 7（静态生成）+ 原生 TypeScript + 手写 CSS + Web Audio / Web MIDI / matter-js |
| 语言 | 中文在根路径 `/`，英文加前缀 `/en/`，同一套模板 |
| 主题 | `modern` / `baroque` 两套，由 `<html data-theme>` 决定 |
| 开发 | `npm run dev`（astro dev） |
| 构建 | `npm run build` → `dist/`；本地预览 `npm run preview` |
| 检查 | `npm run check`（astro check，必须 0 error）；`npm test`（node:test，纯逻辑单测） |
| 部署前 | 改 `astro.config.mjs` 的 `site` 和 `src/lib/site.ts` 的 `SITE.url`（目前是 TODO 占位 `https://example.com`） |

### 目录结构

```
src/
├── pages/        路由层：一个文件 = 一个 URL，只做"取数据 + 交给 view"
├── views/        版式层：页面长什么样（双语共用）
├── layouts/      BaseLayout.astro：全站唯一外壳（head / header / footer / 脚本入口）
├── components/   可复用 UI（T / Header / MusicSystem / MiniLab / IdentityStage ...）
├── scripts/      ★ 浏览器端行为：DOM、音频、键盘、MIDI（只在客户端执行）
├── lib/          ★ 纯数据 + 纯函数：可被 views / scripts / tests 共用，不碰 DOM
├── i18n/         文案字典 + 路径工具
├── styles/       tokens.css（设计变量）/ global.css（背景 + 玻璃系统，含 `.glass--liquid` 厚玻璃）
├── content/      Markdown 内容（blog / lab / pages，`名字.zh.md` / `名字.en.md`）
└── tests/        node:test 单元测试（只测 lib 和纯逻辑）
```

### 三条最重要的架构规则

1. **分层**：pages 只取数、views 只排版、components 只呈现、scripts 只碰 DOM、lib 不碰 DOM。
   放错层最常见的症状：构建期代码里用了 `document`，或浏览器脚本里 import 了 `astro:content`。
2. **状态只有一个来源**：`AppStore`（`src/scripts/app-state.ts`）。任何 UI 都不许自己存一份状态，只能读 store 或监听它的 `change`。
3. **样式只用 token**：颜色 / 圆角 / 时长 / 缓动都来自 `src/styles/tokens.css` 的 CSS 变量。组件里写死颜色，换主题时一定掉队。

---

## 2. 运行时架构

### 2.1 页面渲染（构建期）

```
src/pages/index.astro ──> views/JourneyPage.astro ──> views/HomePage.astro ──> components/*
src/pages/blog/[...slug].astro ──> views/PostPage.astro
src/pages/en/** 与上面共用同一批 views，只是传 lang="en"
```

- 路由文件本身很薄：见 `src/pages/blog/[...slug].astro`，只调用 `src/lib/pages.ts` 的 `postStaticPaths(lang)` / `buildPostProps(post)`。
- 文案在构建期由 `useTranslations(lang)` + `<T k="..." lang={lang} />` 输出，文本来自 `src/i18n/ui.ts`。
- 内容集合定义在 `src/content.config.ts`（blog / lab / pages 三个 collection，schema 也在那）。

### 2.2 浏览器端启动（客户端）

全站只有一个脚本入口，在 `src/layouts/BaseLayout.astro` 底部：

```astro
<script>import '@/scripts/app.ts';</script>
```

`src/scripts/app.ts` 的 `boot()` 是**唯一的初始化顺序表**（顺序有讲究）：

```
AppStore → initTheme() → initSystemMessages() → initLangSwitch() → initClock()
       → MusicManager → initMusicUI() → initContact() → initIdentity()
       → initMiniLab() → initEasterEggs() → initThemeSwitcher() → initJourney()
       → initEntryGate()
```

- 项目在用 Astro ClientRouter（客户端路由）。**换页时脚本不会重新执行**，只会触发 `astro:page-load` → 再跑一次 `boot()`。
  所以每个绑定都必须幂等（用 `dataset.ready === '1'` 之类的守卫），或在 `astro:before-swap` 里注销。
- 跨页面存活的系统（音乐、主题）挂在 `src/scripts/global.ts` 的 `getGlobal()` 单例上（实际挂在 `window`）。
- `clearTimers()` 在每次 boot 开头清掉上一页留下的定时器。

### 2.3 数据流

```
用户操作（鼠标 / 电脑键盘 / MIDI 键盘 / 彩蛋序列）
   → 各系统（MiniLab / EasterEggManager / ThemeSwitcher / Contact ...）
      → AppStore.set(...)              ← 唯一的写入口
         → 派发 'change' 事件
            → ThemeManager / MusicManager / Footer / Nav 等自动跟上
```

### 2.4 双语的三层机制

| 层 | 位置 | 用途 |
| --- | --- | --- |
| 构建期模板 | `src/i18n/ui.ts` + `useTranslations()` + `<T k="..." />` | 静态文本，SSR 时就写进 HTML |
| 运行期替换 | `data-i18n` / `data-i18n-aria` + `swapChrome(lang)` | 语言切换后不刷新页面、只换 UI 文案 |
| JS 里的文案 | 组件上的 `data-word-*` / `data-label-*` 属性 | 脚本需要输出的动态文字（READY、播放、暂停…），脚本读 DOM 而不是再存一份字典 |

---

## 3. 功能地图（先查这里）

| 功能 | 入口文件 | 关键函数 / 类 | DOM / 事件钩子 |
| --- | --- | --- | --- |
| 头部导航 | `src/components/Header.astro` | 纯模板 | `.site-header`、`[data-section-target]` |
| 页脚 | `src/components/Footer.astro` | 纯模板 | — |
| 现代主题背景 + 面板玻璃材质 | `src/styles/tokens.css`、`src/styles/global.css` | `--bg-image` / `--paper*`（全站同一片淡蓝底）、`--liquid-*` token 与 `.glass--liquid`（时钟 / 播放器 / 联系方式用的面板材质，与顶栏同款透明玻璃） | `html[data-theme]`（modern / baroque 两套值） |
| 语言切换 + 文字滑出/滑入 | `src/scripts/lang.ts`、`src/styles/global.css`、`src/scripts/app.ts` | `initLangSwitch()`、`swapChrome()`、`collectTextElements()`、`markIncomingLanguageText()`、`markLanguageSwap()` / `takeLanguageSwap()`（切语言这一趟的记号）、`restoreScrollAfterSwap()` / `restoreScrollAfterLoad()`（保留滚动位置） | `[data-lang-switch]`、`html[data-lang]`、`.lang-slide-out` / `.lang-slide-in`、sessionStorage `space.lang-scroll` / `space.lang-swap` |
| 主题切换（modern/baroque） | `src/scripts/theme.ts`、`src/scripts/theme-switch.ts`、`src/lib/themes.ts` | `ThemeManager`、`initTheme()`、`initThemeSwitcher()`、`setTheme()`、`toggle()` | `html[data-theme]`、`[data-theme-switch]` |
| 全站状态 | `src/scripts/app-state.ts` | `AppStore.get()` / `set()` / `isUnlocked()` / `hasUnlocks()` | `'change'` 事件（detail: `{ state, previous }`） |
| 焦点圈（仅键盘） | `src/scripts/input-modality.ts`、`src/styles/global.css` | `trackInputModality()` | `html[data-input]` |
| LCD 时钟 | `src/components/LcdClock.astro`、`src/scripts/clock.ts` | `initClock()` | `[data-clock]`、`[data-clock-time]`、`[data-clock-date]` |
| 背景音乐播放器 | `src/components/MusicSystem.astro`、`src/scripts/music-manager.ts`、`music-ui.ts`、`src/lib/music.ts` | `MusicManager`、`initMusicUI()` | `[data-music]`、`[data-music-toggle/-progress/-volume/-state/-title/-subtitle/-time]` |
| 播放进度记忆 | `src/lib/live-timeline.ts` | `savedPosition()` / `savePosition()` / `restartPosition()` | sessionStorage `space.position.v1.<id>` |
| MiniLab 25 键 | `src/components/MiniLab.astro`、`src/scripts/minilab.ts`、`notes.ts` | `initMiniLab()`、`MiniLabController` | `[data-minilab*]`、`[data-midi]`、`data-word-*` |
| 钢琴采样引擎 | `src/scripts/piano.ts`、`src/lib/piano.ts` | `PianoEngine`、`nearestSample()`、`playbackRateFor()`、`samplesForRange()` | 事件 `piano:state` / `piano:context` / `piano:progress` |
| 合成器（无采样兜底） | `src/scripts/synth.ts` | `KeysSynth.unlock()` / `noteOn()` / `noteOff()` / `allNotesOff()` | — |
| 真实 MIDI 键盘 | `src/scripts/midi.ts` | `MidiBridge`、`getMidiBridge()` | 事件 `midi:noteon` / `midi:noteoff` / `midi:change` |
| 彩蛋（隐藏曲目） | `src/lib/easter-eggs.ts`、`src/lib/sequences.ts`、`src/scripts/easter-eggs.ts` | `EASTER_EGGS`、`HOLD_TO_ARM` / `isArmChord()`（入口和弦）、`createSequenceDetector()`、`createSequenceSession()`、`EasterEggManager`（`toggleHint()` / `holdNote()` / `releaseNote()`） | `[data-note]`（琴键）、事件 `minilab:note` / `minilab:release` / `egg:hint` / `egg:accept` / `egg:miss` |
| About 身份实验场 | `src/components/IdentityStage.astro`、`src/scripts/identity-player.ts`、`identity-physics.ts`、`identity-playback.ts`（出声的那一半）、`src/lib/identity.ts`、`identity-midi.ts` | `createIdentityPhysics()`（`reveal()` / `restore()` / `placeMissing()` / `snapshot()`，内部 `makeBody()` 管尺寸自愈）、`initIdentity()`、`disposeIdentity()`、`setIdentityActive()`、`identityRevealPlan()`、`createNocturnePlayback()`（`arm()` / `enter()` / `leave()` / `toggle()` / `restart()` / `seek()` / `pos()`） | `[data-identity*]`、`[data-identity-tag][data-revealed]`、cookie `rest-note-identity-v3-<visit>` |
| 手机摇晃彩蛋（标签跟着晃） | `src/scripts/identity-motion.ts`、`src/lib/shake.ts`、`src/scripts/identity-physics.ts`（`shove()`）、`src/scripts/entry-gate.ts`（入场时申请权限） | `requestMotionAccess()`、`attachIdentityMotion()`、`createShakeDetector()` | `[data-identity]`、`[data-entry-button]`（申请运动权限的那次手势）；传感器事件 `devicemotion`；`getGlobal().motionAccess` |
| 夜曲共用的那架琴（关于 ⇄ 关于我） | `src/scripts/identity-audio.ts`、`src/scripts/identity-playback.ts`、`src/scripts/identity-player.ts`、`src/scripts/nocturne.ts`、`src/scripts/app.ts` | `identityPiano()`（三处共用的实例）、`releaseIdentityPiano()`、`rampIdentityVolume()`；只有自我介绍页那一侧还在用 `handOverIdentityPiano()` / `takeIdentityHandover()` / `HANDOVER_AHEAD` | `getGlobal().identityPiano` / `.identityHandover`；无 DOM 钩子 |
| 自我介绍页（第十个标签的去处） | `src/views/IntroPage.astro`、`src/pages/about/intro/index.astro`、`src/content/pages/intro.zh.md` / `intro.en.md`、`src/lib/pages.ts` | `getPage('intro', lang)`、`render(entry)`、`introRoutes` | `[data-identity-link]`（写在 About 页的标签上） |
| 联系方式 / 复制 | `src/components/ContactTiles.astro`、`ContactPanel*.astro`、`src/scripts/contact.ts`、`src/lib/contact.ts` | `initContact()`、`CONTACT`、`isInteractive()` | `[data-contact]`、`[data-contact-row]`、`[data-contact-copy]` |
| 系统提示 LCD | `src/components/SystemMessage.astro`、`src/scripts/system-message.ts` | `initSystemMessages()` | `[data-system-message]`、window 事件 `space:message` |
| 入场页 | `src/components/EntryGate.astro`、`src/scripts/entry-gate.ts` | `initEntryGate()` | `[data-entry-gate]`、`[data-entry-button]`、`[data-entry-copy]` |
| 首页 Journey 长页 | `src/views/JourneyPage.astro`、`src/scripts/app.ts` 里的 `initJourney()` | `initJourney()` | `[data-journey]`、`[data-journey-section]` |
| 博客列表 / 标签 | `src/views/BlogIndexPage.astro`、`src/lib/content.ts` | `getPosts()`、`collectTags()` | — |
| 文章页 | `src/views/PostPage.astro`、`src/lib/pages.ts` | `buildPostProps()`、`postStaticPaths()`、`tagStaticPaths()` | — |
| Lab 页 | `src/views/LabPage.astro`、`src/content/lab/*` | `getExperiments()` | — |
| About 页 | `src/views/AboutPage.astro`、`src/content/pages/about.*` | `getPage()` | — |
| 404 | `src/views/NotFoundPage.astro` | — | — |
| RSS / sitemap | `src/pages/rss.xml.ts`、`src/pages/en/rss.xml.ts` | `GET` | — |
| 控制台留言 | `src/scripts/console-note.ts` | `logConsoleNote()` | — |

---

## 4. 页面与路由

| URL | 路由文件 | 版式（view） | 内容来源 |
| --- | --- | --- | --- |
| `/`、`/en/` | `src/pages/index.astro`、`src/pages/en/index.astro` | `views/JourneyPage.astro`（把首页/博客/Lab/About 拼成一条滚动长页） | lib 数据 + content |
| `/blog/`、`/en/blog/` | `src/pages/blog/index.astro`、`src/pages/en/blog/index.astro` | `views/BlogIndexPage.astro` | `content/blog/*` |
| `/blog/tags/<tag>/` | `src/pages/blog/tags/[tag].astro` | `views/BlogIndexPage.astro`（带 currentTag） | `tagStaticPaths()` |
| `/blog/<slug>/`、`/en/blog/<slug>/` | `src/pages/blog/[...slug].astro` | `views/PostPage.astro` | `postStaticPaths()` |
| `/lab/`、`/en/lab/` | `src/pages/lab/index.astro` | `views/LabPage.astro` | `content/lab/*` |
| `/about/`、`/en/about/` | `src/pages/about/index.astro` | `views/AboutPage.astro` | `content/pages/about.*` |
| `/about/intro/`、`/en/about/intro/` | `src/pages/about/intro/index.astro`、`src/pages/en/about/intro/index.astro` | `views/IntroPage.astro` | `content/pages/intro.*`（`getPage('intro', lang)`） |
| `/404.html` | `src/pages/404.astro` | `views/NotFoundPage.astro` | — |
| `/rss.xml`、`/en/rss.xml` | `src/pages/rss.xml.ts`、`src/pages/en/rss.xml.ts` | — | `getPosts()` |

### 加一个新页面的步骤

1. 在 `src/views/` 写版式（用 `BaseLayout`，`embedded` 版式则用 `Passthrough`）。
2. 在 `src/pages/` 写路由文件，只做 `lang` / `routes` 的传参。
3. 双语页面写两份路由文件（`/en/...`），`lang="en"`。
4. 如果页面需要"当前页 ↔ 另一语言"的地址，用 `src/lib/pages.ts` 里对应的 `RoutePair` 常量（不够用就加一个）。
5. 页面上任何给脚本看的元素加 `data-*` 钩子，并在 §7 表格登记。
6. 更新本文档 §3 与 §10。

---

## 5. 模块详解

> 每个小节格式：**职责 → 导出（函数/类）→ 关键行为 → 坑**。

### 5.1 双语 i18n

**文件**：`src/i18n/ui.ts`、`src/i18n/utils.ts`、`src/components/T.astro`

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `languages` | `{ zh: { htmlLang, short, label }, en: {...} }` | 语言元信息 |
| `defaultLang` / `locales` | `'zh'` / `['zh','en']` | — |
| `ui` | `{ zh, en }`，全站文案字典，key 用点号命名空间（`nav.*` `blog.*` `minilab.*`…） | 新增文案**两个语言都要加** |
| `UIKey` | `keyof typeof zh` | TS 上保证 key 拼写正确 |
| `getLangFromUrl(url)` | `(url: URL \| string) => Lang` | 从地址判断语言 |
| `useTranslations(lang)` | `(lang: Lang) => (key: UIKey, params?) => string` | 构建期取文案 |
| `fill(template, params)` | `(string, Record<string, string\|number>) => string` | 文案里 `{n}` 占位替换 |
| `stripLangPrefix(pathname)` / `localizePath(pathname, lang)` | 路径前后缀处理 | 语言切换、导航、hreflang 都靠它 |
| `otherLang(lang)` / `normalizePath(pathname)` | — | 工具 |

**T.astro**：`<T k="nav.blog" lang={lang} />` 渲染纯文本，并同时写出 `data-zh` / `data-en` 两个属性 —— 这是运行期 `swapChrome()` 能就地换语言的前提。组件里任何"会切换语言的 UI 文案"都应该用 `<T>`，或手动带上 `data-i18n` + `data-zh/data-en`。

### 5.2 全站状态 AppStore

**文件**：`src/scripts/app-state.ts`

```ts
type AppStateSnapshot = {
  theme: ThemeName;              // 'modern' | 'baroque'
  currentTrack: string;          // 当前曲目 id
  unlockedTracks: readonly string[];
  hintMode: boolean;             // 彩蛋提示模式（不落盘）
  eggActive: boolean;            // 彩蛋进行中（不落盘）
};
class AppStore extends EventTarget {
  get(): AppStateSnapshot;
  set(patch: Partial<AppStateSnapshot>, options?: { persist?: boolean }): void;
  isUnlocked(trackId: string): boolean;
  hasUnlocks(): boolean;
}
```

- **只能通过 `set()` 改状态**；`set()` 内部判断"真的变了"才派发 `change`，避免无谓重渲染。
- `set()` 派发 `CustomEvent<'change'>`，detail 是 `{ state, previous }`：所有 UI 监听它跟新。
- 落盘：`theme` → localStorage `space.theme`；`unlockedTracks` → localStorage `space.unlocked`；`hintMode` / `eggActive` 是本次会话的临时状态。
- 单例存在 `getGlobal().store`，客户端路由换页后不重建（从 localStorage 恢复）。

### 5.3 主题 ThemeManager

**文件**：`src/scripts/theme.ts`、`src/scripts/theme-switch.ts`、`src/lib/themes.ts`、`src/styles/tokens.css`

```ts
class ThemeManager extends EventTarget {
  attachMusic(music: MusicManager): void;    // 主题与音乐绑在一起
  syncTheme(): void;                          // 把 store 里的主题写进 <html data-theme>
  get theme(): ThemeName;
  setTheme(next: ThemeName, options?: { animate?: boolean; persist?: boolean }): void;
  toggle(): void;
}
function initTheme(store: AppStore): ThemeManager;   // 站点级单例
function initThemeSwitcher(store: AppStore, theme: ThemeManager): void;
```

- 换主题 = 改 `<html data-theme="...">`。颜色/材质全部写在 `tokens.css` 的 `[data-theme='baroque']` 选择器里，**组件里不写死颜色**。
- 有动画时（`animate: true`）ThemeManager 会复制一层旧背景 `.ambient-ghost` 淡出，做出真正的 crossfade；同时 `<html>` 上短暂挂 `.theme-shift`，让颜色连续补间。
- 主题与 `currentTrack` 是**同一次 store.set()** 写入的，不会出现"界面已经切了、音乐还没切"的中间态（音乐切歌见 §5.5）。
- `ThemeSwitcher` 组件只在解锁过至少一首隐藏曲目（`hasUnlocks()`）后才存在，自己没有任何状态。
- 纯函数在 `src/lib/themes.ts`：`isThemeName()`、`trackForTheme()`、`nextTheme()`、`THEMES`、`DEFAULT_THEME`、`THEME_STORAGE_KEY`。

### 5.4 语言切换与文字动画

**文件**：`src/scripts/lang.ts`（逻辑）、`src/styles/global.css`（动画）、`src/scripts/app.ts`（换页钩子）

```ts
function getDocumentLang(): Lang;
function getPreferredLang(): Lang | null;
function swapChrome(lang: Lang): void;              // 就地替换 [data-i18n] / [data-i18n-aria]
function initLangSwitch(): void;                    // 绑定 [data-lang-switch]
function markIncomingLanguageText(doc: Document): void;  // 换页前给新文档文字挂"滑入"
function markLanguageSwap(pathname: string): void;  // 换页前留一次性记号 sessionStorage 'space.lang-swap'
function takeLanguageSwap(): boolean;               // 目标页取走记号：true = 这一趟是"切语言"（身份标签据此保留落点，§5.8）
// 内部：
collectTextElements(root)      // TreeWalker 收集"承载文字的元素"，祖先命中则跳过后代
playOut(elements) / playIn(elements)
switchChromeInPlace(target)    // 两种语言共用同一地址时（如 404）的兜底
rememberScrollPosition()       // 换页前存 { y, hash, anchor }（sessionStorage 'space.lang-scroll'）
restoreScrollAfterSwap()       // 第一段：astro:after-swap 里先对齐（View Transition 快照才是对的）
restoreScrollAfterLoad()       // 第二段：astro:page-load 里再对齐（关于页此时才把标签搬进 body，文档高度变了）
forgetSavedScroll()            // 只在导航失败时丢弃（成功时必须留给第二段）
applySavedScroll()             // 两段共用的收尾：地标对齐 → 收敛到文档高度 → 接回 #锚点
// 内部：地标（换页后要按回原处的那一块）
probeY() / isBlock() / visibleHeight() / blockChildren()
blockAtEye()                   // 视线高度（视口 45%）那一块：从 main 逐层钻进"刚好包住这点"的块级元素
dominantBlock()                // 占住视口的那一块：每层挑露出最多的孩子，低于四成就停
findAnchor() / resolveAnchor() // 记下子节点路径 + 视口高度；新页面按同一路径找回来
readAnchor()                   // 从 sessionStorage 读出来的东西先验形状
```

**点击一条语言链接的完整链路**：

```
click [data-lang-switch]
  → writeString('space.lang', target)
  → collectTextElements(document) 收集全部文字元素
  → playOut()：加 .lang-slide-out（240ms 向左滑出 + 淡出；pointer-events:none）
  → 等 SLIDE_MS
  → sessionStorage['space.lang-transition'] = '1'
  → sessionStorage['space.lang-swap'] = 目标 pathname（身份标签=保留落点；见 §5.8）
  → navigate(href)（Astro 客户端导航，不刷新浏览器）
     ↳ astro:before-swap 钩子里 markIncomingLanguageText(newDocument)：
         给新文档的文字加 .lang-slide-in，并去掉 .rise（跳过入场动画）
         同时 app.ts 的 before-swap 钩子 disposeIdentity()：离开前把标签"此刻"的落点写进 cookie
     ↳ 新页面插入第一帧就开始"从右滑入"
     ↳ astro:after-swap：restoreScrollAfterSwap() 把滚动位置放回去（第一段）
  → boot() → playIncomingTransition()：清标记，动画结束后摘掉类名
  → astro:page-load：restoreScrollAfterLoad() 再对齐一次（第二段）
  → finally：兜底摘掉 .lang-slide-out（导航失败时文字能恢复）
```

- 动画时长 `SLIDE_MS = 240`，与 CSS 里的 `var(--dur-2)` 保持一致（改一个要改两处）。
- 跳过 `.ambient` / `.entry-gate` / `script` / `style` 等节点；`svg` 子树不动。
- 元素原本的透明度（少数弱化文字不是 1）会记在 `--lang-opacity` 里，动画结束回到原值。
- 系统开启 *减少动态效果*（`prefers-reduced-motion: reduce`）时：完全跳过动画和等待，直接切换。
- 语言偏好存 localStorage `space.lang`；进站时若偏好与页面语言不同，只换 UI 文案（正文语言仍由 URL 决定）。
- **切语言不弹回顶部（两段式 + 地标对齐）**：ClientRouter 每次换页都会 `scrollTo(0, 0)`（`astro/dist/transitions/router.js` 的 `moveToLocation`），所以 `lang.ts` 在 `navigate()` 之前把 `scrollY`、`#hash` 和**视口里的地标**存进 sessionStorage `space.lang-scroll`，再分两次对齐：
  1. `restoreScrollAfterSwap()`（`astro:after-swap`）—— 时机在那次滚动之后、View Transition 拍"新页面"快照之前，位置接得上又不会和动画打架；
  2. `restoreScrollAfterLoad()`（`astro:page-load`）—— 关于页此时才由 `initIdentity()` 把标签搬进 `body` 改成绝对定位，文档高度会变，只对齐一次会被浏览器按旧高度截断（那就是本人看到的"切完语言发生位移"）；`document.fonts.ready` + 一帧之后还会再对一次（字体就位布局才会定），但若这中间用户自己滚过（和上次落点差 ≥4px）就不抢他的位置。
  两个函数共用 `applySavedScroll()`：**先按地标对齐**——把换页前视口里那一块按回原来的高度（`offset` 是它当时的视口 top）；地标找不回来才退回老像素。另外用 `behavior: 'instant'`（站点全局有 `scroll-behavior: smooth`，`auto` 会变成慢悠悠地滚回去）、把 y 夹到当前文档高度上限，并在 URL 丢了 `#hash` 时用 `history.replaceState` 接回去（router 只按 `to.href` 写地址，`#about` 会被它丢掉）。
- **为什么不能只按像素恢复**：英文普遍比中文长，换页后上面那些内容的高度会变 —— 实测首页（那串拼接页）切语言时整块"关于"区在文档里下沉 **115px**，自我介绍页整篇高 **1639px**。只把老 `scrollY` 滚回去，人正在看的那一块就被挤走（本人报的"位移"）。所以地标优先：选"占住视口的那一块"（不是视口最上面那一行——那可能只是上一段滚出去的尾巴），长文页（每层都是整屏高、钻不到段落）改成**视线高度那一块**（视口 45% 处，`probeY()`）。实测：首页滚到关于区切语言，`[data-identity]` 的屏幕位置 98 → 98（**0px**），滚动位置 2714 → 2829 正好抵消那 115px；自我介绍页滚到 4000 处切语言，`<article>` 里视口顶端那块 −25 → −25（**0px**）。
- **长文页为什么要按视线高度对齐**（本人第二次复报"关于我那一页还是有问题"之后改的）：一开始对齐点取的是视口**最上沿**，实测自我介绍页切语言时，屏幕**中间**那段文字漂了 90–180px —— 正好是人正在读的地方（EN ↔ ZH 的段落高度不同，漂移从对齐点往远处累积）。改成 45% 高度之后，同一组测试里中间那段只动 0 到 −30px，剩下的漂移被摊到屏幕上下两边（±90 左右），而且页面该滚多少还是精确算出来的。
- **切语言是"同一页换种说法"，不是"换了一趟路"**：`markLanguageSwap(pathname)` 在换页前把目标 pathname 写进 sessionStorage `space.lang-swap`，目标页 `takeLanguageSwap()` 取走一次（对不上就丢掉，不留残余）。身份标签靠它区分"重新落一次"和"原样留着"（见 §5.8）。
- **一个曾经的坑**：收尾的 `finally` 里原本无条件 `forgetSavedScroll()`，而 `navigate()` 在 View Transition 更新完 DOM 时（`astro:page-load` 之前）就返回了 —— 于是第二段对齐永远读不到位置，等于只有一段。现在只有 `navigate()` 真抛错时才丢弃。改这条链路时留意调用顺序。

### 5.5 背景音乐

**文件**：`src/components/MusicSystem.astro`、`src/scripts/music-manager.ts`、`src/scripts/music-ui.ts`、`src/lib/music.ts`、`src/lib/live-timeline.ts`

```ts
class MusicManager extends EventTarget {
  get track(): Track;
  init(): void;                         // 首次用户手势后解锁音频
  play(): Promise<void>; pause(): void; toggle(): void;
  resume(): void;                       // 暂停后恢复
  crossfadeTo(id, options?): Promise<void>;   // 换曲（force 可强制出声）
  setVolume(v) / setMuted(v) / toggleMute() / setDucked(v): void;
  getState(): 'idle'|'ready'|'active'|'paused'|'error';
  getVolume(): number; isMuted(): boolean; isPlaying(): boolean;
  getProgress(): { currentTime, duration, ratio };
  seekToRatio(ratio): void;
  setAboutActive(active: boolean): void;      // 进 About 时压低音量（duck）
}
function initMusicUI(music: MusicManager): void;
```

- 事件：`MusicManager` 派发普通 `'change'`；UI（`music-ui.ts`）监听它刷新标题/状态/进度，并支持同页多个面板（`[data-music]` 循环绑定）。
- 音量渐变用 `requestAnimationFrame`（`ramp()`），进度两头都 `clamp01`；`prefers-reduced-motion` 时直接跳到目标音量（不渐变）。
- 曲目定义在 `src/lib/music.ts`：`TRACKS`、`DEFAULT_TRACK_ID`、`AUDIO`（音量常量）、`getTrack()`；纯函数 `clamp01()` / `easeOutQuad()` / `volumeAt()`（有单测 `tests/audio.test.mjs`）。
- 进度记忆在 `src/lib/live-timeline.ts`：`savedPosition(id, duration)` / `savePosition(id, position)` / `restartPosition(id)`，存 sessionStorage `space.position.v1.<id>`，只记"真正播放过"的位置。
- 切主题会触发 `crossfadeTo()`（主题 ↔ 曲目绑定见 `src/lib/themes.ts` 的 `THEME_TRACK`）。
- **"关于"这一族页面会让位**：`app.ts` 的 boot 里，只要页面上有 `[data-identity]`（About）或 `[data-nocturne]`（自我介绍页），就调用 `music.setAboutActive(true)` —— 主题音乐被暂停、音量归零，`play()` / `init()` 也会直接返回；这两页放的是同一首夜曲的钢琴演奏（§5.8 / §5.14）。回首页（Journey）时仍由 `initJourney()` 的观察器控制。
- UI 文案（READY / PLAYING / 播放 / 暂停）从组件上的 `data-word-*` / `data-label-*-zh|-en` 读，脚本不再维护字典。

### 5.6 键盘乐器：MiniLab / 钢琴 / MIDI

**文件**：`src/components/MiniLab.astro`、`src/scripts/minilab.ts`、`src/scripts/piano.ts`、`src/scripts/synth.ts`、`src/scripts/notes.ts`、`src/scripts/midi.ts`、`src/lib/piano.ts`

```ts
// minilab.ts
type MiniLabController = { press(midi, velocity, source); release(midi); releaseAll(); dispose(); };
type NoteSource = 'pointer' | 'keyboard' | 'midi';
function initMiniLab(): void;

// piano.ts（采样引擎）
class PianoEngine extends EventTarget {
  scheduleNote(...); noteOn(midi, velocity?); noteOff(midi, release?); allNotesOff();
  preload(): Promise<void>; ensure(): void;
  getState(): 'idle'|'loading'|'ready'|'failed';
  getLoadedRatio(): number; get requiredSamples(): PianoSample[];
  setVolume(v); dispose();
}
// 事件：piano:state（状态变化）/ piano:context（AudioContext）/ piano:progress（采样加载进度）

// synth.ts（无采样兜底）
class KeysSynth { unlock(); noteOn(midi, velocity?); noteOff(midi); allNotesOff(); }

// midi.ts
class MidiBridge extends EventTarget { getStatus(); getInputs(); dispose(); }
function getMidiBridge(): MidiBridge;
// 事件：midi:noteon / midi:noteoff / midi:change
```

- 输入统一汇到 `MiniLabController.press/release`，再由它决定发声（钢琴采样优先，`PianoEngine` 失败时退回 `KeysSynth`）并更新屏幕读数。
- 电脑键盘映射在 `src/scripts/notes.ts`：`KEYBOARD_MAP`、`midiFromKey()`、`noteName()`、`midiFromName()`、`isBlackKey()`、`isCKey()`、`frequency()`、`MINILAB_KEYS`（有单测 `tests/notes.test.mjs`）。
- 采样表在 `src/lib/piano.ts`：`PIANO_SAMPLES`、`nearestSample(midi, samples?)`、`playbackRateFor(sample, midi)`、`samplesForRange(min, max, samples?)`（决定"哪些采样必需"，`PianoEngine.requiredSamples` 用它）。
- MIDI 权限在 Lab 页第一次交互时才申请（不在页面加载时打扰用户）。
- MiniLab 不认识彩蛋：它只是收到 `egg:hint` 时把对应琴键点亮。

### 5.7 彩蛋（隐藏曲目）

**文件**：`src/lib/easter-eggs.ts`（配置 + 纯函数）、`src/lib/sequences.ts`（旋律识别）、`src/scripts/easter-eggs.ts`（管理器）

```ts
// lib/easter-eggs.ts
type EasterEgg = { id, theme, notes: string[], maxGapMs, message, detail?, hintLabel, unlocks?, resultTheme };
EASTER_EGGS: EasterEgg[];
eggForTheme(theme): EasterEgg | undefined;
eggById(id): EasterEgg | undefined;
EGG_SEQUENCES: string[][];                       // 给测试用

// lib/sequences.ts（纯逻辑，有单测 tests/sequences.test.mjs）
createSequenceDetector(sequences, { maxGapMs = 2600 }): { push(note, at?) => 命中索引 | -1, reset, history }
createSequenceSession(sequence, { maxGapMs = 2600 }): { push(note, at?) => { correct, matched, progress }, reset, progress, length, awaiting }

// scripts/easter-eggs.ts
class EasterEggManager extends EventTarget {
  get hintArmed(): boolean;
  toggleHint(): void;    // 进入 / 退出提示模式（两条入口都走它）
  disarm(): void;
  holdNote(note): void;      // 长按入口：某个音被按住
  releaseNote(note): void;   // 长按入口：某个音松开
  note(note: string): void;   // 唯一的音符入口
}
function initEasterEggs(store: AppStore, theme: ThemeManager): void;
```

**进入提示模式的两条入口**（等价，配置在 `lib/easter-eggs.ts` 的 `HOLD_TO_ARM`）：

| 入口 | 谁用 | 怎么判定 |
| --- | --- | --- |
| `Shift` + `P` | 电脑键盘 | `keydown`，只认带 shiftKey 的 p；页面上没有 MiniLab 时无效 |
| **同时按住 `D4` + `F#4` 一秒** | 触屏 / 鼠标 / 键盘都行（手机上唯一做得到的） | `minilab:note` / `minilab:release` 维护"当前被按住的那组音"，`isArmChord()` 为真之后计时 `HOLD_TO_ARM.holdMs`（1000ms）；中途松开任何一个就作废，按住不放只触发一次（想退出得松开再按住同样久）。键盘上等价于按住 `x` + `g` |

**三条铁律（写在 `lib/easter-eggs.ts` 注释里）**：

1. 彩蛋内容绝不出现在页面上，也不给访客文字答案。
2. 每条彩蛋只属于一个主题：提示模式按"当前主题"挑序列（modern 里没有返回序列，反之亦然）。
3. 提示模式一次只亮一个键，不显示完整序列 / 进度数字 / "下一个音"。

**一次完整触发**：

```
MiniLab 弹下某个键
  → window 'minilab:note' { midi, note, velocity, source }
     → EasterEggManager.holdNote(note)   （只喂给长按入口）
     → EasterEggManager.note(note)
        → 不在提示模式 → 直接返回（不比对、不记录）
        → 在提示模式：SequenceSession.push()
             命中 → trigger()：解锁曲目写入 store + theme.setTheme(resultTheme)
                               + 'space:message' 系统提示 + 'egg:hint' 收尾
             按对 → window 'egg:accept'（琴键先 ACCEPTED，再亮下一个）
             按错 → window 'egg:miss'（当前提示轻闪一下，不清空重来）

MiniLab 松开某个键
  → window 'minilab:release' { midi, note }
     → EasterEggManager.releaseNote(note)  （长按入口：中途松手就作废计时）
```

- 管理器是 `getGlobal().eggs` 单例：**客户端路由换页后进度不丢**。
- `initEasterEggs` 里有一个 `global.eggsBound` 守卫，避免重复绑定 `minilab:note` 与 Shift+P。
- **加一条新彩蛋 = 往 `EASTER_EGGS` 数组加一条**，不用改 MiniLab、不用改管理器（测试会校验它是否能在 25 键上弹出来）。

### 5.8 About：身份实验场

**文件**：`src/components/IdentityStage.astro`、`src/scripts/identity-player.ts`、`src/scripts/identity-physics.ts`、`src/scripts/identity-motion.ts`（手机摇晃彩蛋）、`src/scripts/identity-audio.ts`（跨页共用的那架琴，见 §5.14）、`src/lib/identity.ts`、`src/lib/identity-midi.ts`、`src/lib/shake.ts`

```ts
// identity-player.ts
initIdentity(): void;          // 页面存在 [data-identity] 才初始化
disposeIdentity(): void;       // 注销（换页 / 离开 About 区时）
setIdentityActive(active: boolean): void;  // 进入/离开视口时激活

// identity-playback.ts（只管出声：解锁 / 位置 / 起跑余量 / 暂停恢复，不碰 DOM）
createNocturnePlayback({ engine, timeline, notes, duration, onState, onTick }): {
  arm(): void;                   // 在用户手势里建/唤醒 AudioContext（iOS 只认手势）
  enter(): Promise<void>;        // 这一区进入视野：想听就接着从记忆位置放
  leave(): void;                 // 离开这一区：停手，进度留下
  toggle(): void;                // 播放键：在"放"和"停"之间切换
  restart(): void;               // 重播：清进度从头来
  seek(seconds: number): void;   // 拖进度条
  pos(): number;                 // 当前听到的位置（秒）
  playing / state: 'idle' | 'waiting' | 'playing' | 'paused';
  dispose(): void;
}

// identity-physics.ts（matter-js）
createIdentityPhysics(root, tags, onSettled?, onActivate?): {
  reveal(index, source?): void;    // 从键盘位抛出（没给 source 就走"静止队形"）
  restore(layout): number;         // 按 cookie 里的落点摆好（按地板差值整体平移），返回摆好几个
  markPlaced(): void;              // 把场上这些记成"已上场"并解除快照冻结（切语言用，见下）
  snapshot(): IdentityLayout;      // 此刻的文档像素落点 + 地板位置（离开页面前写进 cookie）
  shove(x, y): void;               // 手机摇晃彩蛋：把设备加速度当一阵推力灌进场地
  reset(): void;                   // 清空身体与记忆（重新演奏按钮）
  dispose(): void;
}

// identity-motion.ts（手机端独有的彩蛋）
attachIdentityMotion(root, shove): () => void;   // 返回注销函数

// lib/shake.ts（纯逻辑，有单测）
createShakeDetector({ threshold?, peaks?, windowMs?, quietMs? }): { push(magnitude, at?), reset(), peaks }

// lib/identity.ts
IDENTITY_TAGS / IDENTITY_TAG_IDS / tagLabel(tag, lang) / tagById(id)
IDENTITY_MOTION   // 弹出→飞行→落地→停稳 的时序常量
IDENTITY_TRACK_SRC // 驱动这个体验的 MIDI 文件（public/music/secret/...）

// lib/identity-midi.ts
parseMidi(bytes: Uint8Array): MidiScore;
identityRevealPlan(score, count): 每个标签的揭示时刻（并校验曲子的弱起结构）
```

- 标签的入场不是 `scale(0)→scale(1)`，而是被"弹出来"的物理动画：ejection → flight（浅抛物线 + 轻微旋转）→ landing → settle。运行时碰撞材质在 `identity-physics.ts` 的 `makeBody()`，抓取手感由 pointerdown 的关节刚度/阻尼控制；`IDENTITY_MOTION` 是入场时序规格，不是 Matter 运行时材质参数。长标签惯量在创建时统一设定，无变化的 `bounds()` 通知保留休眠状态。
- **手机端独有的彩蛋：摇晃手机，场上的标签跟着一块晃。** `identity-motion.ts` 把 `devicemotion` 接到 `lib/shake.ts` 的摇晃识别上（默认：1.1 秒窗口里攒够 **3** 次 ≥ **11** m/s² 的强脉冲），识别成功后打开一段 4.2 秒的"跟着晃"时间窗（窗内继续晃会一直续上）：窗里每次采样都把设备加速度换算成一阵**冲量**交给 `physics.shove(x, y)`。三条边界写在文件头：**只有手机端**（`(pointer: coarse)` + 有 `DeviceMotionEvent`）、**只有 About 这一块在屏幕上时才听传感器**（IntersectionObserver，否则会在看不见的地方把标签甩乱、还费电）、**开了 reduced-motion 就完全不挂**。阈值与推力在 `identity-motion.ts` 顶部（`GAIN` / `MAX_ACCEL` / `MIN_ACCEL`）与 `lib/shake.ts` 的默认值里。
  - `shove()` 给的是**冲量（直接改速度）**，不是力：标签躺在地板上（`friction .65`），按重力那一档施力走一步就被摩擦吃掉 —— 实测只推动 **1px**，看起来就是"摇了没反应"。冲量是立刻见效的（gain 6 ≈ 晃一下跳几厘米），再叠一点向上抬升与自转，方块才会真的跳起来翻滚（和 `reveal()` 把标签抛出来是同一种量级）。
  - `shove()` 会**解除 `frozen`**：从落点记忆恢复出来的方块是 `frozen` 且不在 `dropped` 里（"先摆出来"的兜底，见 `restore()`）。当初把这两种一起跳过，结果是**凡是这一趟进过 About（有落点记忆）的人摇起来毫无反应** —— 本人 iPhone 上就是"弹窗有了但摇不动"。现在场上所有方块都参与，还没上场的（没有本体）自然不会被摇出来。
  - 排查读数（写在 `[data-identity]` 上，和 `data-nocturne-at` 同一个习惯）：`data-motion` = `off` / `idle` / `listening` / `shaking`，`data-motion-shakes` = 识别到几次摇晃，`data-motion-pushes` = 真的推了几次。"摇了没反应"先看这三个数：没到 `listening` 是挂载问题，`shakes` 不动是阈值问题，`pushes` 有数但标签不动才是物理问题（这次就是最后一种）。
- **iOS 的运动与方向权限在入场页那次点击里申请**（`requestMotionAccess()`，被 `entry-gate.ts` 的"进入空间"处理器调用）：iOS 只允许在用户手势里调 `DeviceMotionEvent.requestPermission()`，而"进入"是全站人人都要做的那一次点击 —— 同意之后这一趟里摇晃彩蛋随手就能用。**只把权限挂在"碰标签"上是不够的**：本人 iPhone 实测只是摇了手机、没先碰标签，权限从没被申请过，传感器一个事件都收不到，看起来就是"摇了没反应"。
  - 状态是**三态**，记在 `getGlobal().motionAccess`：`true` 批过、`false` 明确拒绝过、`undefined` 还没问过。拒绝过的不再问 —— iOS 本来也不会再弹，反复调用只会让日志变脏。
  - **只问一次**：`askOnce()` 的结果缓存在模块内的 `pendingRequest` 上，所以"入场点击"和"About 区兜底"同一次点击里各调一次时仍然只发一个请求（实测：入场点击只调用 1 次 `requestPermission`）。iOS 上重复调用是危险的：第二次常常立刻返回 `denied`。
  - **识别手持设备用两条判据**（`isHandheld()`）：`(pointer: coarse)`，或者 `maxTouchPoints > 1` 且 UA 含 `iPad|iPhone|iPod|Macintosh` —— iPhone 开"请求桌面网站"后 UA 会变成 Mac，只看 media query 会漏掉这种机器。桌面上（两条都不满足）直接记 `false`、不打扰。
  - **被拒绝时会说一句实话**：`announceMotionOffline()` 通过 `space:message` 在 LCD 上打一行 `MOTION OFFLINE / motion & orientation access denied`（只在页面真有 `[data-identity]` 时）。这是设备读数，和 MiniLab 的 `NO DEVICE` 同一种语气，也是排查"为什么摇不动"的第一现场。
  - 兜底入口：这一块在屏幕上时，用户点 / 滑页面任何地方也会走同一个 `requestMotionAccess()`（`document` 捕获阶段的 `pointerdown`，只触发一次）。
- 布局（标签落点）会存 cookie：`readLayout()` / `writeLayout()` / `clearLayout()`（内部函数，cookie 名 `rest-note-identity-v3-<visit>`，visit id 每次会话一个；`v3` 是落点格式版本，见下）。这份记忆**只当"先摆出来"的兜底**（万一声音还没解锁，页面也不会是一片空地）：`physics.restore()` 之后 `needsAnimation` 仍然是 `true`，音乐一响 `reveal()` 就把已有的身体重新抛回场上再落一次 —— 每次回到这一页，方块都是活的（本人报过"返回之后方块的物理效果就没了"）。`reset()`（重新演奏按钮）会连内部的 `dropped` 一起清空、并 `clearLayout()`，所以下一轮整排重抛。
- **visit id 跟着"是不是新的一趟访问"走**：`identity-player.ts` 模块加载时，如果这次导航的 `performance.navigation.type` 是 `navigate`（地址栏输入 / 外链 / 书签），就先清掉 sessionStorage 里的 `rest-note.identity-visit`，让下面重新生成一个 —— 于是落点 cookie 是新的、标签会被音乐重新抛一遍。`reload` / `back_forward` 沿用同一个 visit（刷新不算新访问），和入场页的 `rest-note.entry-passed` 是同一条规矩。原因见 §10：浏览器"继续上次的标签页"会把 sessionStorage 一起恢复，不这么做的话上一趟的落点会一直沿用，"每一次进入都是一趟新访问"这件事就消失了。
- **加载乐谱会自动重试；`data-bound` 必须最后才立**：`initIdentity()` 读 `public/music/secret/*.mid` 失败时最多重试两次（间隔 1.2s / 2.4s）再报错，重试挂在同一条 abort 信号上，换页不会漏。另外 `root.dataset.bound = 'true'` 这个"已初始化"记号要放在拿到 2d 上下文**之后**：放在前面的话，取上下文失败的那一次会把自己锁死（后面每次 `initIdentity()` 都被这个记号挡在门外），整块区域一直死到刷新页面为止 —— 本人反馈的"必须手动刷新一下才开始加载 MIDI、重播点了也没反应"就是这个形态。取不到上下文就留个空门，滚回这一块时还能再试。
- **落点存的是文档像素坐标 + 地板位置**（`{ floor, items: [{ x, y, angle }] }`，`x/y/angle` = 本体中心 + 角度），不是归一化比例。曾经存过比例（`(x-left)/(right-left)`、`(floor-y)/floor`），但两种语言的页面高度差几像素，比例还原时会被整体缩放，实测偏 20-80px —— 本人看到的就是"切语言之后标签位移"。`floor` 是写下落点时 `.identity__landing` 下沿的文档位置：换语言/换宽度会让整块区域上下移动（实测首页那串拼接页切到英文时下沉 **115px**），`restore()` 会先算 `shift = floor_now - layout.floor` 再整体平移，标签才不会漂出自己那一块。改格式记得同时改 `LAYOUT_VERSION`（cookie 名字里那个 `v3`），否则新代码会把旧格式的值当新格式读。
- `bounds()` 与 `restore()` 的夹取只做"别出视口、别陷进地板"（`x ∈ [8, width-8]`、`y ∈ [8, floor-4]`），**不按方块自己的尺寸算**。按尺寸算会出事：脚本刚接手时量到的元素尺寸常常是错的（样式还没应用，实测 46px 的标签量成 134px），一夹就把方块顶歪 44px；按舞台宽度夹也会把更宽的英文标签整排推走（实测偏 75px）。另外 `bounds()` 里有**尺寸自愈**：元素尺寸和造本体时记下的不一样，就用同一个中心重造本体（位置不动，只补尺寸），`document.fonts.ready` 之后还会再量一次。
- **切语言是唯一的例外：位置原样接续，恢复的身体重新受重力，还没上场的继续排队，不提前补位、不重弹。** 判定靠 `lang.ts` 的 `takeLanguageSwap()`（sessionStorage `space.lang-swap`，见 §5.4），流程是：
  ```ts
  physics.restore(readLayout());        // 摆好记忆里的落点（含地板平移）
  needsAnimation = true;                // 计划照旧跑：剩下的标签仍由音乐按原时刻放出来
  if (takeLanguageSwap()) physics.markPlaced();  // 已上场：不再重抛；解除 frozen/sleeping，半空标签继续下落
  ```
  **切语言时绝不能把缺的标签一次补齐。** 曾经这里是 `placeMissing()`（把还没上场的直接摆进静止队形），结果人点了翻译、歌还没播到那一段，十个标签全弹出来了（本人复报的 bug）。实测：切语言时场上 2 个 → 旧逻辑 350ms 后 10 个全出；现在 2 个原地不动，音乐走到 0:09 出第 3 个、0:33（乐谱截止时刻）凑满 10 个。
  五个坑，改这里之前先看：
  1. **别用模块变量判"这一趟是切语言"**。`navigate()` 在 View Transition 更新完 DOM 时就返回了，新页面的脚本是随后才加载执行的 —— 点击处理器里的收尾早就跑完，模块变量必然已经清空（实测新页面读到的永远是 `false`）。跨页只能用 sessionStorage 记号。
  2. **别用 `restored < tags.length` 当"要不要重落"的判据**。cookie 快照是"上一次全部静止时"写的，而人往往在标签还滚着的时候就点了切换 —— 实测快照只有 7/10 条，`restore()` 返回 7，于是十个标签被整排重抛，看起来就是"切语言之后全弹了一遍"（本人报的 bug）。
  3. **离开页面前要写"此刻"的落点**，不能只靠静止时的那次快照：`disposeCurrent`（`astro:before-swap` → `disposeIdentity()`）里会 `writeLayout(physics.snapshot())`，把正在运动的身体也一并记下来，切到对面语言时才能一个不差地摆回原位。
  4. **别用"刚接手时量到的元素尺寸"去夹位置**。新页面的脚本可能在样式应用之前就跑起来了，这时候 `offsetWidth/offsetHeight` 全是错的（实测 46px 量成 134px），拿它算边界会把方块顶歪 44px。所以夹取只跟视口和地板有关；`bounds()` 会在尺寸对不上时用同一个中心重造本体（见上面那条）。判断"是否零位移"要看**中心点**，别拿 `getBoundingClientRect()` 的 top/left 比 —— 旋转过的方块，盒子一变宽它的外接矩形就会整体移动，那是量法的问题不是 bug。
  5. **`restore()` 会把快照身体设为 frozen + sleeping，切语言后必须由 `markPlaced()` 解除两者。** 快照可能是在标签飞行中途写下的；只标记 dropped 而不唤醒，会把标签永久钉在半空，看起来像物理引擎失效。`prefers-reduced-motion` 模式仍保持 sleeping，符合无动画偏好。
- **"拖不动"的三个来源**（本人在独立页面/切语言后都遇到过）：① `pointerup` 丢事件（指针在窗口外松开、被系统弹窗抢走）→ `drag` 卡在"正在拖"，之后谁按都拖不动；② 拖到一半 `bounds()` 因窗口/尺寸变化重造了本体 → 拖拽关节还挂在被移出世界的旧本体上，标签跟着指针却一动不动；③ 标签还没被音乐放出来（场上没有本体，按住无效，这是设计如此）。前两个已经在 `identity-physics.ts` 里堵死：`window` 上兜底监听 `pointerup` / `pointercancel` / `blur`，`pointerdown` 时若发现上一次拖拽超过 2.5s 就先替它收尾，`bounds()` 重造本体时把 `drag.joint.bodyB` 接到新本体上。
- **第十个标签（`intro`）是唯一的例外**：它是唯一能点开的标签（点一下进整页自我介绍，见 §5.14）。文案四行（标题 + 三行请求，`lib/identity.ts` 里用 `\n` 分行、`tagLines()` 拆开渲染成四个 `span`，**不再用括号**），样式上它**不比别的标签大**：标题与其它标签同号或略小，下面三行再小一号、淡一点（`.identity__tag-title` / `.identity__tag-note`）。尺寸**不能用 `transform: scale()`** —— 物理引擎每帧都会重写 inline `transform`。想调它的大小只改 `.identity__tag[data-identity-link]` 的 `font-size` 一行。
- 点按判定在 `identity-physics.ts`：按下后位移 < 8px、且 0.7s 内抬手才算"点击"；拖动过就不算（"抛掷"不能被误认成"点开"）。命中 + 元素带 `data-identity-link` 才回调 `onActivate`，由 `identity-player.ts` 走 `astro:transitions/client` 的 `navigate()`（失败退回 `location.assign`）；键盘上按回车同样打开。
- **拖动不能触发链接**：第十个标签是 `<a href>`，浏览器在 `pointerup` 之后还会自己补一发 `click`（`setPointerCapture` 让目标仍是它），光靠点按判定拦不住。所以只要这一次抬手不算点按，就把 `swallowClickUntil` 设成"现在 + 300ms"，由文档级捕获阶段的 `click` 监听把这一发 `click.preventDefault()` 掉 —— 拖完标签不会跟着跳页（本人报过的 bug），点一下照常进自我介绍页。
- `reveal()` 算"备用队形"（没接住音符时靠地面排队）的间距时只统计普通标签：可点击的那个宽得多，算进去会把整排挤成单列。
- 首页 Journey 模式里，`initJourney()` 用 IntersectionObserver 在滚到 About 区时调用 `initIdentity()` / `setIdentityActive(true)`（见 `src/scripts/app.ts`）。
- **分工：`identity-player.ts` 管"看得见的那一半"，`identity-playback.ts` 管出声。** 瀑布流（`draw()` / `render()`）、标签物理、播放控件、进度条、主题曲让位都在 player 里；解锁、位置与进度记忆、起跑余量、暂停恢复全在 playback 里，两边只通过 `onState` / `onTick` / `pos()` 说话。player 自己**不再**维护 `offset` / `origin` / `cursor` / `timer` 那一套（曾经它和 live-timeline 两份位置互相打架）。
- 三条不能动的规矩（都是踩过的坑，写在 `identity-playback.ts` 文件头，改之前先读）：
  1. **起跑余量放 `origin`**（`origin = currentTime + LEAD - from`），不是加在播放位置上 —— 加在位置上会把开头第一个音直接跳过去；
  2. **只排"还没开始"的音，且 `elapsed = 0`**：接续点之前已经响过的音不重排（重排 = 同一瞬间重敲几个没有音头的音，手机上的"颤动"就是这个）；
  3. **位置只走 live-timeline**（`space.position.v1.identity:nocturne`），进度写回只此一条路。
- 手机端"第一次滑到关于区就有声音"靠三层：入场页那次点击里 `primeIdentityPiano()` 先把 AudioContext 建起来（iOS 只认手势）；这一区里的每一次 `pointerdown` / `keydown` / `wheel` 都会 `arm()` + `enter()` 再试一次（上下文可能被系统打断成 `interrupted`）；`piano:context` / `piano:state` 一有动静就自己接上。`waiting` 状态就是"想放但音频还没被手势解锁"，此时页面提示"点击或按键，即可接入钢琴演奏"。
- 音乐靠现有 `PianoEngine.scheduleNote()` 播 MIDI，不另做一套音频链路；排程只发生在 `identity-playback.ts` 的定时器里，**动画帧永远不出声**。
- 单测：`tests/identity.test.mjs`、`tests/identity-midi.test.mjs`（真实 MIDI 文件解析）。

### 5.9 联系方式与复制

**文件**：`src/lib/contact.ts`、`src/scripts/contact.ts`、`src/components/ContactTiles.astro`、`ContactPanel.astro`
（另有 `ContactPanelBaroque.astro`：**当前没有任何页面引用它**，是预留的 baroque 版面板；要启用它必须自己接进某个 view，并确认 `data-contact-*` 钩子齐全。）

```ts
// lib/contact.ts
type ContactChannel = { id, labelKey, value, href?, copy?, icon? };
CONTACT: readonly ContactChannel[];
isInteractive(channel): boolean;

// scripts/contact.ts
initContact(): void;
```

- 事件委托绑在 `document` 上，换页不需要重新绑。
- 复制优先级：`navigator.clipboard.writeText()` → 隐藏 textarea + `execCommand('copy')`；两种都失败就**不显示成功反馈**（不撒谎）。
- 反馈只有两处：行内 `[data-copied]` 把 COPY 换成 COPIED（1.2s），以及 `space:message` 系统提示。文案从 DOM 读，自动跟随语言。
- 账号本身不翻译，只有栏目名走 `ui.ts`。

### 5.10 系统提示（LCD 通知）

**文件**：`src/components/SystemMessage.astro`、`src/scripts/system-message.ts`

```ts
initSystemMessages(): void;   // 监听 window 'space:message'
```

- 任何模块都可以 `window.dispatchEvent(new CustomEvent('space:message', { detail: { message, detail? } }))` 发提示。
- 显示 3.6s 后自动隐藏（定时器登记到 `global.timers`，换页会被清掉）；通过 `[data-visible='true']` 控制显隐，隐藏时 `visibility: hidden` 彻底离开无障碍树。

### 5.11 入场页 EntryGate

**文件**：`src/components/EntryGate.astro`、`src/scripts/entry-gate.ts`、`src/scripts/app.ts`

```ts
initEntryGate(music: MusicManager): boolean;   // true = 正在拦着（页面被锁）
```

- 只在"地址栏输入 / 书签 / 外链"（navigation type = `navigate`）时要求重新入场；`reload` / `back_forward` 沿用 sessionStorage `rest-note.entry-passed`。
- 进入方式：点击 `[data-entry-button]`。这个 click 处理器里**必须直接调用** `music.play()`（浏览器自动播放策略要求音频解锁发生在可信手势里，见代码注释）。
- **点"进入"之后一定落在首页最顶上（`#home`）**：遮罩收起时把地址里遗留的锚点（浏览器恢复标签页时常见的 `#about` / `#blog`）去掉，并 `scrollTo(0, 0)`；因为 `html` 有 `scroll-behavior: smooth`，必须用 `behavior: 'instant'`，否则会当着他的面滑一大段。**要补三次**（立即 / 下一帧 / 260ms 后）：Safari 常在遮罩收起之后才把上次的滚动位置恢复回来，只滚一次会被它盖掉；后两次都跳过"有 `#锚点`"的情况 —— 那是用户自己点的站内跳转，不能抢。站内导航走客户端路由，不经过这里。
- 同一个 click 处理器里还调两个"必须在用户手势里做"的动作：`requestMotionAccess()`（`identity-motion.ts`，申请"运动与方向"权限，见 §5.8）和 `primeIdentityPiano()`（`identity-audio.ts`，把"关于"那架钢琴的 AudioContext 建起来并开始预载采样，见 §5.14）。两者都只在真正需要它们的页面生效，桌面 / 不需要 / 已经做过时静默返回，不影响入场。
- 锁定期间 body 加 `.entry-locked`，除 gate 和 `.ambient` 外的直接子元素设为 `inert`。
- 文案跟随浏览器语言（`navigator.language` 是否 `zh` 开头），不是站点语言。
- `app.ts` 里：`if (!initEntryGate(music)) music.init();` —— 有入场页时由入场页负责解锁音频。

### 5.12 时钟与控制台

**文件**：`src/components/LcdClock.astro`、`src/scripts/clock.ts`、`src/scripts/console-note.ts`

- `initClock()`：对所有 `[data-clock]` 面板，用 `Intl.DateTimeFormat`（时区 `Asia/Singapore`）每秒刷新 `[data-clock-time]` / `[data-clock-date]`；秒变化时加 `.is-tick` 做很轻的 LCD 刷新感（reduced-motion 时跳过）。
- 定时器登记进 `global.timers`，换页时由 `clearTimers()` 清理。
- `logConsoleNote()`：给打开 DevTools 的人留一句话，仅此而已。

### 5.13 样式系统

| 文件 | 内容 |
| --- | --- |
| `src/styles/tokens.css` | 全部设计变量：字体/字号/行高、圆角、缓动与时长、布局栅格、模糊、纸张与墨色、accent/glow、玻璃、**厚玻璃（`--liquid-*`）**、LCD、控件、渐变（`--grad-*`）。**背景（`--paper*` / `--bg-image` / `--bg-vignette` / `--bg-texture`）也在这里，且只有一套：首页、关于、博客、Lab、自我介绍、入场页共用同一片淡蓝底**（没有首页专用的背景覆盖文件了）。`[data-theme='baroque']` 里是第二套值；文件底部有 reduced-motion 覆盖（时长压到 1ms） |
| `src/styles/global.css` | 站点基础：Reset / Ambient 背景 / Layout / Typography / Glass 系统（`.glass--1..4` + **`.glass--liquid`：与顶栏同款的透明玻璃**）/ LCD 系统（`.lcd`）/ 状态灯 / Controls / 页面入场（`.rise`）/ **语言切换文字动画（`.lang-slide-out` / `.lang-slide-in`）** / 主题过渡（`.theme-shift`）/ 无障碍 / Prose |

规则：

- 组件里**只允许用语义 token**（`--ink`、`--glass-2`、`--liquid-fill`、`--accent`…），不写死颜色；否则换主题一定掉队。
- 玻璃卡片用 `.glass` + `.glass--N`；**"像一个实体容器"的面板（时钟 / 播放器 / 联系方式）用 `.glass--liquid`**（它只是把 `.glass` 的自定义属性换成 `--liquid-*` 那一套，几何和过渡仍然共用）；LCD 面用 `.lcd`。
- **`.glass--liquid` 的铁律：只透色，不上色**。填充保持在 0.11 白这一档、色偏层 `--glass-tint` 与内部镜面层 `--glass-surface` 一律 `none`。想让面板更"厚"时，先加模糊和边光，不要加彩色渐变或大块白 —— 那会变成"往玻璃上刷颜色"，本人已经否掉过一版。
- 页面入场动画是 `.rise` / `.rise--2/3/4`（一次性 CSS animation）。**语言切换进新页面时会被有意去掉**（见 §5.4），因为那一次只该动文字。
- 所有动画都要在 `@media (prefers-reduced-motion: no-preference)` 里，或自己判断 reduced motion。
- **焦点圈只在键盘操作后画**：全局 `:focus-visible` 规则挂在 `html[data-input='keyboard']` 下；鼠标/触摸时连浏览器自带的默认圈也一起关掉（`html[data-input='pointer'] :focus-visible:not(input, textarea, select, [contenteditable='true'])`）。状态由 `src/scripts/input-modality.ts` 的 `trackInputModality()` 维护（boot 里调用，换页后重新写回 `<html>`）。原因见 §10「焦点圈又冒出来」那条：脚本 `focus()` 会被浏览器判成"键盘焦点"。
- **文字颜色一律显式声明，不要靠继承**。Safari（WebKit）**不给"从祖先继承来的颜色变化"做补间**：切主题时 `.theme-shift` 给全站挂的那套 `transition` 只对"自己写了 `color`"的元素生效，靠继承的元素会**直接跳色**（Chrome / Firefox 继承也能补间，所以这个坑只在 Safari 上看得到）。本人 iPhone 实测：同一个 `.page__head.rise` 里的 `.lede` 平滑渐隐（自己写了 `color: var(--ink-2)`），旁边的 `.page__title` 直接变色（一个 `color` 都没写）。所以：**各页主标题、正文块级元素都写出自己的颜色**（`.page__title` / `.post__title` / `.labitem__title` / `.letter-page__title` / `.identity h2` / `.prose > *`）。改这类样式之后用 §10 那条的"颜色快照"办法验证：逐元素比对修改前后的 computed color，必须一条不差。

### 5.14 自我介绍页（About 第十个标签的去处）

**文件**：`src/views/IntroPage.astro`、`src/pages/about/intro/index.astro`、`src/pages/en/about/intro/index.astro`、`src/content/pages/intro.zh.md`、`src/content/pages/intro.en.md`、`src/scripts/nocturne.ts`

- 路由常量：`src/lib/pages.ts` 的 `introRoutes = { zh: '/about/intro/', en: '/en/about/intro/' }`；About 页第十个标签的 `href` 就是它。
- 正文是内容集合 `pages` 里的 Markdown，视图里 `getPage('intro', lang)` + `render(entry)`；文案只有本人原文（中文）和对应英文翻译，**不要在这里补写没确认过的自我介绍**。
- **本人标了分段的地方 = Markdown 的 `##`**：`.letter :global(h2)` 只负责"加大加粗"（`clamp(1.55rem … 2.05rem)` + `font-weight: 700`）。本人后来要求把标题上方那道"⸻ 短线"删掉，**不要再加回任何装饰线**。改标题层级时别把 `.prose h2` 的默认样式当回事，这里是有意覆盖的。
- 头图来自 `src/images/Gensokyo.png`，用 `astro:assets` 的 `<Image>`（自动出 webp + srcset，2.6MB → 33/70/142/273kB 四档）。`src/images/` 的图不要手写 `<img>`，也不要拷进 `public/`。
- 阅读栏宽度与文章页一致：`max-width: calc(var(--measure) + var(--gutter) * 2)`；正文用 `.prose` 纸面，页脚一个"回到关于"链接。
- **左上角有一个返回按钮**（中文只写`返回`，英文写 `Back to About`；中文里"关于"两个字是多余的，英文语法需要宾语，所以只改中文）：`a.letter-page__back` 和页脚那个"回到关于"都指向 **`localizePath('/', lang) + '#about'`**，也就是首页那串拼接页里的关于区，**不是独立的 `/about/` 页**。本人要求：从这一页回去要落回"整串页面"里的关于区（他进这一页多半是从那里点的第十个标签）。实测点返回后：URL `/#about`（英文 `/en/#about`）、关于区停在屏幕上 78、`body > [data-identity-arena]` 存在、十个标签都在且能拖。
- **背景音乐：这一页接着放 About 页的夜曲，而且是"不断音"的接法**（不放主题曲）。`src/scripts/nocturne.ts` 用 `PianoEngine` + `parseMidi()` 复刻 About 的演奏，和 `identity-player.ts` 共用 `live-timeline` 的同一个 id（`identity:nocturne`）；音量用 `IDENTITY_INTRO_VOLUME`（0.7，比演奏模式的 0.85 克制）。
- **跨页共用同一架琴（`src/scripts/identity-audio.ts`）—— "关于 ⇄ 关于我"听起来是一口气弹下来的。** 以前两页各自 `new PianoEngine()`：换页时旧页面 `dispose()`（`allNotesOff` + 关掉 AudioContext）、新页面重新解码采样、再从 0 淡入，听感上就是"停一下再从头接上"。现在引擎挂在 `getGlobal().identityPiano` 上（About / 自我介绍 / 首页关于区共用同一个实例）：
  1. **交棒现在只有自我介绍页那一侧还在用**：`nocturne.ts` 离开时仍然先把接下来 `HANDOVER_AHEAD`（0.45 秒）的音排进音频时钟，再 `pause(keepRinging = true)`（**不** `allNotesOff`），并 `handOverIdentityPiano(听到的位置, 听到的位置 + HANDOVER_AHEAD)`；
  2. **但 About / 首页关于区那一侧已经不发、也不接交棒了**：`identity-player.ts` 现在只用 `identity-playback.ts`，进区/出区分别是 `enter()` / `leave()`，位置一律从 `live-timeline` 的记忆接续（`leave()` 会先把"此刻"写回去）。所以现在"关于 ⇄ 关于我"是**从同一秒接着弹、换页那一下有一小段空隙**，不再是无缝预排。接手方的换算规则仍然是纯函数 `lib/handover.ts` 的 `resumeFromHandover()`（有单测）：`position`（现在应该在哪 = 交棒位置 + 已经过去的时间）与 `from`（从这个位置之后的音才要自己排）**必须分开**，把"已经排到哪"当成"现在在哪"，时间轴就会往前跳 0.45 秒（本人实测的"音乐会向前位移一段"，见 §10）。**这一条是下一次要决定的：要么把交棒并进 `identity-playback.ts`，要么两边都撤掉** —— 现在是不对称状态。
  3. **音量不归零**：`rampIdentityVolume()` 从当前音量滑到这一页的目标音量（About 用滑杆值、自我介绍用 `IDENTITY_INTRO_VOLUME`，滑 600 / 700ms）；手动拖滑杆会取消滑行；
  4. **只在真的离开这一族时才收**：下一张页面里没有 `[data-identity]` / `[data-nocturne]` 时，`app.ts` 在 `astro:before-swap` 里调 `releaseIdentityPiano()` 停声并关掉 AudioContext。
  实测（Playwright + 真实 AudioContext，见 §10 那条）：`/about/` → `/about/intro/` → 返回 `/#about`，`AudioContext` 始终是同一个实例（新建计数全程 0）、采样不重新解码、音量在 0.85 ↔ 0.7 之间滑行（从不归零）、演奏位置接着走（About 的 3.5 秒进到自我介绍的 5.5 秒），去 `/blog/` 时这架琴被释放。
  - `initNocturne()` 在 boot 里调用，`disposeNocturne()` 在 `astro:before-swap` 里调用；缺采样或缺用户手势时只把状态标成 `waiting`，等下一次点击再开始。
  - 切到后台会暂停、切回来接着弹（与 About 页一致）；主题曲的让位由 `app.ts` 的 `setAboutActive(true)` 负责（见 §5.5）。
- 状态钩子：`[data-nocturne-ready]`（乐谱解析完成）、`[data-nocturne-state="waiting|playing|paused"]` —— 排查"这一页怎么没声音"先看这两个。
- 单测：这一页是排版 + 内容 + 浏览器行为，只有常量层面的单测（`tests/identity.test.mjs` 里的音量断言）；改动后在浏览器里核对分节标题、图片、返回按钮与夜曲即可（`npm run build` 会校验内容集合字段）。

---

## 6. 存储与事件

### 6.1 存储 key 总表

| key | 存储 | 作用 | 维护位置 |
| --- | --- | --- | --- |
| `space.theme` | localStorage | 主题偏好（`modern` / `baroque`） | `src/lib/themes.ts` `THEME_STORAGE_KEY` |
| `space.unlocked` | localStorage | 已解锁隐藏曲目 id（JSON 数组） | `src/scripts/app-state.ts` |
| `space.lang` | localStorage | 语言偏好（`zh` / `en`） | `src/scripts/lang.ts` |
| `space.lang-transition` | sessionStorage | 语言切换的一次性标记："新文档要滑入" | `src/scripts/lang.ts` |
| `space.lang-scroll` | sessionStorage | 语言切换前记下的 `{ y, hash, anchor: { path, offset } }`，新页面读完就删（地标对齐 + 两段式恢复，见 §5.4） | `src/scripts/lang.ts` |
| `space.lang-swap` | sessionStorage | 语言切换的目标 pathname（一次性）：对得上才说明"这一趟是切语言"，身份标签据此保留落点（§5.8） | `src/scripts/lang.ts` |
| `space.position.v1.<id>` | sessionStorage | 每首曲子记下"暂停时的位置" | `src/lib/live-timeline.ts` |
| `rest-note.entry-passed` | sessionStorage | 本次会话已通过入场页 | `src/scripts/entry-gate.ts` |

规则：所有读写都走 `src/scripts/storage.ts` 的封装（`readString` / `writeString` / `readNumber` / `readBool` / `writeNumber` / `writeBool`），隐私模式下静默降级，不抛异常。跨设备/长期偏好放 localStorage，一次性、会话内的放 sessionStorage。

### 6.2 自定义事件总表

| 事件 | 目标 | detail | 谁派发 | 谁监听 |
| --- | --- | --- | --- | --- |
| `change` | `AppStore` | `{ state, previous }` | `app-state.ts` | `theme.ts`、其它 UI |
| `change` | `MusicManager` | — | `music-manager.ts` | `music-ui.ts` |
| `space:message` | window | `{ message, detail? }` | 彩蛋 / 联系复制 / 任意模块 | `system-message.ts`（LCD 提示） |
| `minilab:note` | window | `{ midi, note, velocity, source }` | `minilab.ts` | `easter-eggs.ts`（旋律比对 + 长按入口计时） |
| `minilab:release` | window | `{ midi, note }` | `minilab.ts` | `easter-eggs.ts`（长按入口：中途松手就作废） |
| `egg:hint` | window | `{ armed, note }` | `easter-eggs.ts` | `minilab.ts`（点亮下一键 / 熄灭） |
| `egg:accept` | window | `{ note }` | `easter-eggs.ts` | `minilab.ts`（当前键 ACCEPTED） |
| `egg:miss` | window | `{ note }` | `easter-eggs.ts` | `minilab.ts`（提示轻闪一下） |
| `midi:noteon` / `midi:noteoff` | `MidiBridge` | `{ midi, velocity }` | `midi.ts` | `minilab.ts` |
| `midi:change` | `MidiBridge` | — | `midi.ts` | `minilab.ts`（状态灯） |
| `piano:state` | `PianoEngine` | `{ state }` | `piano.ts` | `minilab.ts`、身份页 |
| `piano:context` / `piano:progress` | `PianoEngine` | — | `piano.ts` | 状态显示 |

---

## 7. DOM 钩子总表（改名前先看这里）

> 脚本只认 `data-*`，不认 class。给元素加钩子 = 给脚本加接口；**加/改/删钩子都要同步更新本表**。

### 全局 / 双语

| 钩子 | 谁写 | 谁读 | 用途 |
| --- | --- | --- | --- |
| `html[data-lang]` | `BaseLayout.astro` | `getDocumentLang()` | 当前页面语言 |
| `html[data-theme]` | `ThemeManager.syncTheme()` | 全部 CSS 主题选择器 | 当前主题 |
| `html[data-input]` | `trackInputModality()`（`src/scripts/input-modality.ts`） | `global.css` / `IdentityStage.astro` 的焦点圈规则 | 最近一次操作是 `keyboard` 还是 `pointer`：决定画不画焦点圈 |
| `[data-i18n]` + `data-zh` / `data-en` | `<T>` 或手写 | `swapChrome(lang)` | 运行期换 UI 文案 |
| `[data-i18n-aria]` + `data-aria-zh` / `data-aria-en` | 同上 | `swapChrome(lang)` | 运行期换 aria-label |
| `[data-lang-switch="zh\|en"]` | `Header.astro` | `initLangSwitch()` | 语言切换链接 |

### 主题 / 时钟 / 音乐

| 钩子 | 谁写 | 谁读 | 用途 |
| --- | --- | --- | --- |
| `[data-theme-switch]` / `-btn` / `-value` | `ThemeSwitcher.astro` | `initThemeSwitcher()` | 右下角主题控件（解锁后才存在） |
| `[data-clock]` / `-time` / `-date` | `LcdClock.astro` | `initClock()` | 新加坡时间 |
| `[data-music]` 面板 + `-toggle` / `-progress` / `-volume` / `-state` / `-title` / `-subtitle` / `-time` | `MusicSystem.astro` | `initMusicUI()` | 播放器面板（可多实例） |
| `data-word-ready` / `-active` / `-paused` 等 | `MusicSystem.astro`、`MiniLab.astro` | `music-ui.ts`、`minilab.ts` | JS 动态文字（不维护第二份字典） |
| `data-label-play-zh/-en`、`data-label-pause-zh/-en` | `MusicSystem.astro` | `music-ui.ts` | 播放/暂停按钮的无障碍标签 |

### MiniLab / MIDI

| 钩子 | 谁写 | 谁读 | 用途 |
| --- | --- | --- | --- |
| `[data-minilab]` 根 + `-keys` / `-mode` / `-value` / `-engine` / `-midi` / `-midi-dot` / `-midi-wrap` | `MiniLab.astro` | `initMiniLab()` | 键盘、读数、状态灯 |
| `[data-midi="60"]`（琴键按钮） | `MiniLab.astro` | `minilab.ts` | 每个键的 MIDI 音高 |
| `[data-note="C4"]`（琴键按钮） | `MiniLab.astro` | 提示模式 | 音名（与 `notes.ts` 对应） |

### 彩蛋 / 身份 / 联系 / 提示 / 入场 / 首页

| 钩子 | 谁写 | 谁读 | 用途 |
| --- | --- | --- | --- |
| `[data-identity]` 根 + `-arena` / `-canvas` / `-play` / `-restart` / `-progress` / `-status` / `-time` / `-volume` / `-tag` | `IdentityStage.astro` | `initIdentity()`、`identity-physics.ts` | About 身份实验场 |
| `[data-revealed]` / `[data-dragging="true"]` | `identity-player.ts` | 组件 CSS | 标签出现前隐藏 / 拖拽光标 |
| `[data-motion]` / `[data-motion-shakes]` / `[data-motion-pushes]` | `identity-motion.ts` 写在 `[data-identity]` 上 | 只有排查时人读（脚本不读） | 摇晃彩蛋的三个读数：`off` / `idle` / `listening` / `shaking`、识别到几次摇晃、真的推了几次 |
| `[data-minilab-load]` / `[data-minilab-load-wrap]` / `[data-minilab-load-text]` | `minilab.ts`（`renderLoad()` 写 `--load` 与百分比） | 组件 CSS | 采样加载进度条：一颗音符跑在轨道上，只在真的在加载时出现 |
| `[data-identity-link]` | `IdentityStage.astro`（第十个标签的 href） | `identity-physics.ts`（点按判定 + 回车）、`identity-player.ts`（`navigate()`） | 可点击标签：四行小字（标题 + 三行请求）+ 点开自我介绍页；有它就参与"点击"逻辑 |
| `[data-contact]` / `[data-contact-row]` / `[data-contact-copy]` / `[data-contact-done]` | 联系组件 | `initContact()` | 复制交互与反馈 |
| `[data-copied="true"]` | `contact.ts` 写在 `[data-contact-row]` 上 | 组件 CSS | 行内 COPY → COPIED（1.2s 后自动删掉） |
| `[data-system-message]` + `-text` / `-detail` + `[data-visible]` | `SystemMessage.astro` | `initSystemMessages()` | 左下角 LCD 提示 |
| `[data-entry-gate]` / `[data-entry-button]` / `[data-entry-copy]` | `EntryGate.astro` | `initEntryGate()` | 首次入场 |
| `[data-journey]` / `[data-journey-section="home\|blog\|lab\|about"]` | `JourneyPage.astro` | `initJourney()` | 首页长页滚动定位 |
| `[data-section-target="..."]` | `Header.astro` | `initJourney()` | 导航高亮当前区块 |

---

## 8. 开发约定

1. **分层**：DOM 逻辑只写进 `src/scripts/`；纯逻辑只写进 `src/lib/`（并尽量补单测）；页面数据只在构建期取。
2. **客户端路由**：脚本只跑一次，行为要在 `astro:page-load`（boot）里幂等初始化；需要清理的监听器在 `astro:before-swap` 注销；跨页面的系统挂 `getGlobal()`。
3. **文案**：UI 文案进 `src/i18n/ui.ts`（zh / en 都加）并用 `<T>`；脚本里的动态文字从 DOM 的 `data-word-*` / `data-label-*` 读。
4. **存储**：必须用 `storage.ts` 的封装；key 统一 `space.` 前缀（站点历史 key `rest-note.` 除外）；新 key 要登记到 §6.1。
5. **音频**：只能在用户手势里解锁 / 播放（入场按钮、播放按钮、琴键）；音量补间用 `ramp()` 的 rAF 方案，别用 `setInterval`。
6. **动画**：只动 `transform` / `opacity`（必要时 `filter`）；必须尊重 `prefers-reduced-motion`；时长用 `--dur-*` token。
7. **无障碍**：可交互元素要有 `aria-label`（双语要能跟着换）；提示用 `space:message` 的 LCD 区；隐藏内容用 `visibility` / `inert` 真正移出无障碍树。
8. **测试**：新增纯逻辑（lib、算法、配置校验）就加 `tests/*.test.mjs`，跑 `npm test`；改完至少跑一次 `npm run check`。

---

## 9. 新增功能的标准流程（checklist）

- [ ] 1. 先在 §3 找相似功能，看它的分层与钩子，照着做。
- [ ] 2. 需要文字就加 `src/i18n/ui.ts` 的 zh + en 两份，组件用 `<T>`。
- [ ] 3. 需要状态就加到 `AppStore`（字段 + 落盘策略），不要新建第二份状态。
- [ ] 4. 行为写进 `src/scripts/`（幂等 init），纯逻辑写进 `src/lib/`。
- [ ] 5. 新 DOM 钩子用 `data-*`，并登记到 §7；新存储 key 登记到 §6.1；新事件登记到 §6.2。
- [ ] 6. 样式只用 token；新颜色/材质先加进 `tokens.css` 的两套主题。
- [ ] 7. 需要的话补单测；跑 `npm test` + `npm run check`（有 UI 改动再 `npm run build`）。
- [ ] 8. **在 §10 功能日志追加一条**（这是规定动作，不许省）。

---

## 10. 功能日志（规定动作）

### 2026-09-21 · 夜曲播放器（第二步）：About 演奏改用 identity-playback.ts

- 需求：把已经写好并推送的 `src/scripts/identity-playback.ts` 接进 `src/scripts/identity-player.ts`，删掉里面那套旧的播放逻辑（`schedule` / `begin` / `pause` / `start` / 交棒 / `offset` / `origin` / `cursor` / `timer`），行为保持不变；盯住三条目标：手机端第一次滑到关于区就有声音、滑走再回来不颤动、刷新保留进度。
- 文件：`src/scripts/identity-player.ts`（播放那一路重写，-242/+142 行）、`DEVELOPMENT.md`。
- 函数：削掉模块内的 `start()` / `pause()` / `schedule()` / `tick()` / `time()` 以及 `offset` / `origin` / `cursor` / `timer` / `loading` / `playing` 这些状态，改成**一个** `createNocturnePlayback({ engine, timeline, notes, duration, onState, onTick })` 实例；新增内部函数 `startPlayback()`（"这一区在屏幕上 + 用户想听 + 谱子读好了"三条都成立才 `enter()`）。播放键 → `arm()` + `toggle()`、重播键 → `restart()`、进度条 → `seek()`、`setIdentityActive()` → `enter()` / `leave()`、`visibilitychange` / `pagehide` → `leave()`、销毁 → `dispose()`；`label()` 改成读 `playback.playing` / `playback.state`（`data-state` 仍是 `playing` / `waiting` / `paused`）；`notes` 改成往同一个数组里 `push`（播放模块持有这个引用，不能整份重新赋值）。
- 钩子/数据：无新增 `data-*` / storage key / 自定义事件；进度仍写 `space.position.v1.identity:nocturne`，只是改由 `identity-playback.ts` 统一读写（`identity-player.ts` 不再 import `live-timeline`）。**跨页交棒从 About 这一侧撤掉了**：About / 首页关于区不再 `handOverIdentityPiano()`，换页按 live-timeline 记忆接续；自我介绍页那一侧的交棒（`takeIdentityHandover()`）暂时"没人接"，见 §5.14 第 1-2 条 —— 这是下一步要决定的事（并进 playback 或两边都撤）。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。真机链路用无头 Chrome + CDP 实测（393×852 手机视口 + 触摸模拟；脚本 `identity-live-check.mjs`，`18/18 项通过`）：
  1. **第一次滑到关于区就有声音**：入场点击之后不再点任何东西、只 `scrollTo` 到底 → `[data-identity][data-state=playing]`、`PianoEngine.scheduleNote()` 16 次、`AudioBufferSource.start()` 16 次，`elapsed` 全为 0（真带音头）；
  2. **滑走再回来不颤动**：滑走 → `paused` 且 1.5 秒内不再排新音、进度停在 3.83s；滑回来 → 从 3.83s 接着放（不是 0:00），回来后新排的 8 个音 `elapsed` 全为 0、起点全部晚于 `currentTime`（旧版的"颤动"就是重排了已经响过的音）；
  3. **刷新保留进度**：`Page.reload` + 一次触摸 → 从记忆位置继续（刷新前 live-timeline 里是 1.02s，刷新后接着往前走，读到 saved 4.73s / 时钟 `0:04`，其中 3.7 秒是刷新后真的在放；从头来会是 `0:00`）；
  4. 另测：`setDucked` 调用序列 `[true,false]`（主题曲让位跟着播放状态走）；播放键能停也能再放（不会"点一下闪停"）、拖到 60% 跳到 `2:57` 继续放、重播键把进度清成 0 从头放；控制台 0 错误。
  - 附带说明（诊断结论，供以后参考）：CDP 合成的触摸和真机有时序差别 —— Chrome 到 `touchend` 才给用户激活，而 `pointerdown` 处理器跑在它之前，所以"第一次合成触摸"只把 AudioContext 建出来（挂 `suspended`）、第二次触摸才真的唤醒它；换成鼠标点击一次就够（真机 iOS 上 `touchstart` 那一下就算数）。上面三步里的第 3 步因此先补一次手势再往下滑，和页面自己"点击或按键，即可接入钢琴演奏"的提示是同一条规矩。

### 2026-09-21 · 修复手机端 About 夜曲滚到底无声、回滚卡顿与播放键闪停

- 需求：首页在电脑端正常，但手机滚到最下面的 About/MIDI 区域没有声音；滚走再回来会卡顿几秒；刷新后手动点播放会先响一下又立刻暂停。同时按本人给出的新版全文替换第一篇文章英文版。
- 根因：① `initJourney()` 用 `intersectionRatio >= 0.35` 判断 About 区域是否活跃。About 区块比手机视口高很多，手机上即使已经滚进该区域，整个区块的可见比例也可能永远到不了 35%；观察器于是调用 `setIdentityActive(false)`，把刚由播放键启动的夜曲立刻暂停。② 声音每次启动/恢复时，首批采样原先直接贴着 `AudioContext.currentTime` 提交且只提前排 0.15 秒；移动端音频线程刚唤醒时没有预滚余量，于是前几个声音会颤动，而使用独立动画帧的瀑布流完全正常，等持续排程稳定后声音也自然恢复。硬刷新会销毁 `AudioContext`，浏览器自动播放规则不允许页面无手势自行发声；已有的首次触摸/播放点击解锁兜底保留，修复后会从 `sessionStorage` 记住的时间点可靠续播。
- 文件：`src/scripts/app.ts`、`src/scripts/identity-player.ts`、`src/scripts/nocturne.ts`、`src/content/blog/the-rest-note.en.md`、`DEVELOPMENT.md`。
- 函数：`initJourney()` 的 About `IntersectionObserver` 改为以 `entry.isIntersecting` 的零交叉判断实际进出视口，不再用对长区块和手机视口不成立的面积比例；`identity-player.ts` 与 `nocturne.ts` 给普通启动/恢复增加 0.14 秒音频预滚，并把持续排程前瞻从 0.15 秒增至 0.4 秒，跨页交棒已有预排程所以不重复加延迟；无新增导出。
- 钩子/数据：无新增 DOM 钩子、storage key 或自定义事件；夜曲进度仍使用 `space.position.v1.identity:nocturne`。
- 验证：`npm test`、`npm run check`、`npm run build`。

### 2026-09-19 · 撤掉 MiniLab 的加载条（回到之前的安静样子）

- 需求：本人明确"**我不要加载条了，就按之前的来**" —— 他反感的不是加载慢，而是这件事被显示出来了。
- 文件：`src/components/MiniLab.astro`（删掉 `[data-minilab-load*]` 的标记与样式）、`src/scripts/minilab.ts`（删掉三个元素引用、`renderLoad()` 与它在 `renderEngine()` 里的调用）、`DEVELOPMENT.md`。
- 保留：`primeMiniLabPiano()`（入场点击时就把这架琴的采样预载好 —— 这才是"第一声就是真实采样"的原因）、`hasSampleFor()` 的合成器兜底（只在采样真的还没到时替一下）、以及之前那些音频修复。
- 验证：`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。

### 2026-09-19 · 归档列表加"月份"这一层 + 年份锚点（参考 Dejavu's Blog 的三层结构）

- 需求：本人给了参考站点 `blog.dejavu.moe/posts/`，要求借它"年份 → 月份 → 条目"的分类方式；选定其中两条（① 年份下加月份小标题带篇数；③ 年份做成锚点 `#2026`），不要阅读时长/字数。
- 参考站的做法（抓下来看）：年份（带该年篇数）→ 月份（带该月篇数）→ 条目（日期 · 阅读时长 · 字数）；标签是独立一页；顶栏另有搜索。
- 文件：`src/views/BlogIndexPage.astro`、`DEVELOPMENT.md`。
- 实现：`groups`（按年）再 reduce 一层 `months`（`{ year, count, byMonth }`）；月份名用 `Intl.DateTimeFormat(lang, { month: 'short' })`（中文 `9月` / 英文 `Sep`）。年份那一格变成 `<a href="#2026">2026 <span>1</span></a>`，`section` 带 `id="2026"`；月份是"细线 + 月份 + 篇数"的行内小标签（第一条月份不画线，避免和年份挤在一起）。年份锚点加了 `scroll-margin-top: calc(var(--nav-h) + 16px)`，顶栏是 sticky 的，跳过来不会被盖住。
- 钩子/数据：无新增 data-* / storage key / 事件（纯模板 + 样式）。
- 验证：`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页；检查构建产物 `/blog/index.html` 的实际节点：`<section class="archive__group" id="2026">` → `archive__yearLink href="#2026"` 后跟篇数 → `archive__monthLabel` 渲染成 `9月` 后跟篇数。首页串页里的 BLOG 区是同一个组件，自动跟着变。

### 2026-09-19 · 撤掉音频/乐谱的调试读数（功能已全部正常）

- 需求：本人确认"全正常了"，要求**只**撤掉调试信息，其它一律不动。
- 文件：`src/scripts/identity-player.ts`（状态文案恢复为 `点击或按键，即可接入钢琴演奏。` / `乐谱加载中…` / `乐谱读取失败，请刷新重试。`，去掉 `data-audio-state` / `data-score-error`）、`src/scripts/piano.ts`（去掉只为调试加的 `audioState()`）、`DEVELOPMENT.md`。
- 保留（这次没动）：乐谱失败自动重试两次、`data-bound` 放到上下文检查之后、采样"没彻底失败就开始弹"、解锁音频每个手势重试直到真的在跑、`state !== 'running'` 就 `resume()`（含 iOS 的 `interrupted`）、合成器兜底、音符加载条、主题曲后台预热。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页；`git diff` 确认相对调试那一版只改了上面这几行。

### 2026-09-19 · "文件都下好了，点播放还是不出声，刷新一下才行"

- 需求：本人反馈音频文件已经下载完，但**点播放键不播、滑到关于区也不播**，刷新页面之后再点就能播 —— 明确说这不是他想要的行为。
- 根因：**所有"解锁音频"的动作都是一次性的**。iOS 上"这一次手势能不能解锁音频"并不总成立：入场那一下点击如果同时弹了"运动与方向"的系统权限框，那次用户激活可能就被用掉了；而代码里：
  1. `primeIdentityPianoOnFirstGesture()` 用的是 `{ once: true }` —— 试过一次就再也不管了；
  2. `MusicManager.play()` 的 catch 只把状态标成 `ready`，**没有**挂"下次交互再试"的兜底（`crossfadeTo()` 里有，`play()` 里漏了）。
  于是这一次没解锁成功，后面按多少次播放键都不会再尝试唤醒，只有刷新页面重新走一次干净的手势才恢复。
- 文件：`src/scripts/identity-audio.ts`、`src/scripts/music-manager.ts`、`DEVELOPMENT.md`。
- 修复：① 钢琴那次手势改成"一直挂着，直到 `identityPiano().isRunning` 真的为真才摘掉监听"；② `play()` 失败时也调 `bindAutoplayFallback()`，下一次交互自己重试。
- 钩子/数据：无新增 data-* / storage key / 事件。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。真机（iPhone）行为待本人复测：按"清缓存 → 首次进站 → 点播放"这条路，不必再刷新。

### 2026-09-19 · 冷缓存第一次进来"点琴键没反应"：合成器先顶上 + 音符加载条 + 采样补下

- 需求：本人清掉缓存模拟"正常用户第一次打开网站"，发现音频相关交互会失灵（点不开），而第一次来的访客看到没反应就直接走了 —— 要求"无论用什么方式，务必让交互都正常，且不要让用户等太久"。他原本设想是在入场页前加一个"下完所有文件才给开始按钮"的进度页；评估后没有采用（全下完 ≈ 采样 1.9MB + 两首主题曲 9.6MB + 乐谱，会为了一个"可能用不到的 About 区"挡住所有人，而且它挡不住"加载逻辑本身有 bug"这类问题，见下一条日志）。改成"**不等站、但第一下必须有反应**"。
- 根因：冷启动时采样还在下载（1.9MB / 30 个），而 `PianoEngine.noteOn()` 在对应采样还没解码时直接 return —— 按下去悄无声息。**"引擎状态是 loading" 和 "这个音有没有采样" 是两件事**，原来只按前者的失败兜底（`state === 'failed'` 才走合成器），所以"正在加载"这一段是哑的。
- 文件：`src/scripts/minilab.ts`（按音兜底）、`src/scripts/piano.ts`（`hasSampleFor()` + 漏掉的采样过一会儿补下）、`src/components/MiniLab.astro`（加载条 + 音符 + 样式）、`DEVELOPMENT.md`。
- 修复：
  1. **按音判断**：`piano.getState() === 'failed' || !piano.hasSampleFor(midi)` → 走 `KeysSynth`（振荡器合成的电钢）；采样到位后同一批琴键自然换回采样音色。松键两边都松（没发声的那侧是空操作）。
  2. **漏掉的采样补下**：`preload()` 第一轮结束后，如果还有没解码成功的，1.5 秒后再来一轮（只补缺的）；失败就作罢 —— 那几个音有合成器兜底。
  3. **加载条**：MINILAB 页脚多了一条进度：轨道（`--line`）+ 填充（`--grad-a` + `--glow`）+ **一颗音符（♪）跑在当前位置**，位置由 `--load`（0–1）算出来，所以 modern 是蓝、baroque 是暖金；只在真的在加载时出现（`piano:progress` / `piano:state` 驱动 `renderLoad()`）。
- 钩子/数据：新增 DOM 钩子 `[data-minilab-load]` / `[data-minilab-load-wrap]` / `[data-minilab-load-text]`（只在页面内部读写，已登记 §7）；无新增 storage key / 自定义事件；新增导出方法 `PianoEngine.hasSampleFor(midi)`。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。Playwright **冷缓存 + 1.2Mbps + 200ms 延迟**下实测（包了 `createOscillator` / `createBufferSource` 计数来区分两个引擎）：进站后立刻按 C4 → **振荡器 +2、bufferSource +0**（立刻有声）、引擎读数 `LOADING`、`hasSample(C4)=false`、加载条可见；等采样到位后再按 → **振荡器 +0、bufferSource +1**（换成采样钢琴）。

### 2026-09-19 · "滑到关于区必须刷新才开始加载 MIDI、重播点了没反应"

- 需求：本人反馈"到底下的关于页必须手动刷新一下才开始加载 MIDI，还要手动按播放；刷新之前点重播没效果"。
- 查证：本地按两条可能的路（`#about` 直接进站 + 旧落点 cookie；从博客页客户端路由跳到首页再下滑）都跑通了 —— 乐谱 2ms 到位、按钮正常、0 报错，说明这是**偶发失败**，而当时的代码在偶发失败下只有两条死路。于是把两条死路都堵掉：
  1. `initIdentity()` 里 `root.dataset.bound = 'true'` 写在拿 2d 上下文**之前**：一旦 `getContext('2d')` 返回 null（低内存 / 偶发），这一次直接 return，而"已初始化"的记号已经立住了 —— 之后每次 `initIdentity()` 都被挡回去，整块关于区一直死到刷新页面为止，表现就是"必须刷新才开始加载"。
  2. 乐谱 fetch 失败时直接写"请刷新重试"，**不会自己再试**。手机上一次请求被系统/网络打断太常见。
- 文件：`src/scripts/identity-player.ts`、`DEVELOPMENT.md`。
- 修复：① 把 `data-bound` 挪到上下文检查之后（拿不到就留个空门，滚回这一块还能再 init 一次）；② 乐谱改成 `loadScore()`，失败自动重试两次（1.2s / 2.4s，同一个 abort 信号），全失败才提示"请刷新"。
- 钩子/数据：无新增 data-* / storage key / 事件。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。Playwright 两处定向验证：
  · **请求失败自动恢复**：用 `page.route` 让第一次 `.mid` 请求 `abort` → 观测到共发出 **2** 次请求、`data-ready=true`、`data-state=playing`、重播按钮可用、**没有刷新页面**、0 console error；
  · **上下文失败不再锁死**：init script 让第一次 `getContext('2d')` 返回 null → 第一次激活后 `data-bound` 仍为 null（没立记号）；滚开再滚回来 → `data-bound=true / data-ready=true / data-state=playing / 重播可用`，同样不需要刷新，0 console error。

### 2026-09-19 · "点开始页之后直接进了关于页/博客页" + "新一趟访问的 cookie 不见了"

- 需求：本人反馈"每一次进入网站（刷新不算）应该是一趟新的访问、并且落在首页最顶上（`#home`）；但现在只有干净的内置浏览器正常，别的浏览器一点开始就直接停在关于页或博客页，连'每一趟都换新 cookie'这件事也不见了"。
- 根因：这两件事是同一个来源 —— **浏览器"继续上次的标签页"会把 sessionStorage 和滚动位置一起恢复**（Chrome / Safari 都会）。于是：
  1. `rest-note.identity-visit` 还是上一趟的那个 id → 落点 cookie 沿用 → 标签不再被音乐重抛（"新访问"的痕迹消失）；
  2. 地址里可能还留着 `#about` / `#blog`，或者浏览器把上次的滚动位置又恢复了一遍 → 点完"进入"人不在首页顶部。
  Instagram 那种内置浏览器每次都是干净的新会话，所以只有它看起来正常。
- 文件：`src/scripts/identity-player.ts`（模块加载时按 `navigate` 清 visit id）、`src/scripts/entry-gate.ts`（进入时清掉遗留锚点 + 拉回顶部，补三次）、`DEVELOPMENT.md`。
- 逻辑：判断"新一趟访问"用的是和入场页同一条规矩 —— `performance.getEntriesByType('navigation')[0].type === 'navigate'`（地址栏输入 / 外链 / 书签），`reload` / `back_forward` 不算。顶部那三下：立即、下一帧、260ms 后各一次（Safari 常在遮罩收起之后才恢复滚动位置）；后两次都跳过"有 `#锚点`"的情况，因为那代表用户刚点了站内跳转。
- 钩子/数据：无新增 data-* / storage key / 事件；沿用 sessionStorage `rest-note.identity-visit`（现在会在新一趟访问时被清掉）。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。Playwright 实测（模拟"恢复的标签页"：预置 `rest-note.identity-visit = OLDVISIT` 并用 `/#about` 打开）—— 点"进入"之后 `location.hash` 变成空、`window.scrollY = 0`、sessionStorage 里的 visit id 变成新的 UUID（不再是 `OLDVISIT`）。

### 2026-09-19 · 按一下音量键，页面底部又冒出那根蓝线（main 的焦点框优先级）

- 需求：本人反馈"一按键盘（天选4 上的音量键），页面底部那根线又出现了"。
- 根因：入场页收尾时会把焦点落到 `<main id="main">`（无障碍需要），而 `main` 顶满整页宽，它的焦点框就是**两条横贯屏幕的蓝线**（上边那条正好被固定导航挡住，所以只看得到底部那一根）。之前为了修掉这个，写过 `main:focus, main:focus-visible { outline: none }`，但键盘焦点框那条规则是 `html[data-input='keyboard'] :focus-visible`，优先级 **(0,2,1)** 高于 `main:focus-visible` 的 **(0,1,1)** —— 于是"鼠标操作时没有框、一按键就冒框"。当年那条修复其实**在键盘模式下从没生效过**；这次按音量键（笔记本媒体键，同样会被记成键盘输入）才暴露出来。
- 文件：`src/styles/global.css`、`DEVELOPMENT.md`。
- 修复：把排除写成同优先级并放在后面：`main:focus, main:focus-visible, html[data-input='keyboard'] main:focus-visible, html[data-input='pointer'] main:focus-visible { outline: none }`。其它元素的键盘焦点框一律不动 —— 真正靠 Tab 操作的人还是要能看到焦点。
- 钩子/数据：无新增 data-* / storage key / 事件。
- 验证：Playwright 走完整入场流程后量 `main` 的 computed outline —— 入场后 `none`；**按 `AudioVolumeDown` 之后仍是 `none`**（修前是 `solid 2px rgb(74,110,224)`）；随后按 Tab，焦点落到 `A.system__name` 并显示 `solid 2px`，键盘可达性没被削弱。`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。

### 2026-09-19 · iPhone 上"手动滑到关于区，夜曲不会自己开始"：把手势里解锁提前到入场页

- 需求：本人反馈"除了我自己手动滑到底部音乐没自动开始播放以外，其他都没问题了"（首页关于区；电脑端会自己开始）。
- 根因：**iOS 只允许在用户手势里创建/唤醒 AudioContext**。原来的顺序是"用户滑到关于区 → 才 `new AudioContext()`"，那一下不在手势里，iPhone 上建出来是 `suspended`，于是只显示"点击或按键，即可接入钢琴演奏"，不会自己弹。桌面浏览器在入场页那次点击之后就已经放行，所以只有手机看得到。
- 文件：`src/scripts/identity-audio.ts`（新增 `usesIdentityPiano()` / `primeIdentityPiano()` / `primeIdentityPianoOnFirstGesture()`）、`src/scripts/entry-gate.ts`（"进入空间"的 click 里调 `primeIdentityPiano()`）、`src/scripts/app.ts`（boot 里挂"第一次手势就唤醒"的兜底）、`src/scripts/identity-player.ts`（采样没齐时不再让人刷新，改为 `piano:state` 变 ready 自己接上）、`src/scripts/nocturne.ts`（同上）、`DEVELOPMENT.md`。
- 逻辑：`primeIdentityPiano()` 只在页面真的有 `[data-identity]` / `[data-nocturne]` 时动作（首页关于区 / 独立 About 页 / 自我介绍页），其它页面不预载、不占带宽；它 `ensure()` 的副作用是顺带开始下载采样，所以等用户滑下去时已经就绪。没走入场页的情况（站内跳转、刷新后入场页不再出现）由 `primeIdentityPianoOnFirstGesture()` 兜底：页面上第一次 `pointerdown` / `keydown` 就唤醒 —— 为了滚动而按下的那一下就算。
- 钩子/数据：无新增 data-* / storage key / 事件。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。Playwright 实测（移动 393×852）：进入前 `identityPiano` 已建但 `ctx=null`；**点"进入空间"之后立刻** `ctx=running / state=ready / loaded=1`（采样 100% 预载完）；随后只做一次 `scrollTo(bottom)`、全程不再点击，`[data-identity][data-state]` 变成 `playing`、标签开始按音乐出场，0 console error。

### 2026-09-19 · 手机端"UI 变了、声音还没跟上"：预热另一套主题的曲子 + 收紧暂停淡出

- 需求：本人反馈"手机端无论是暂停音乐、暂停 MIDI，还是切换主题都会有卡顿 —— UI 已经变了，歌还愣在上一首，或者干脆还没播、要等一会儿；电脑端一切正常"。
- 查代码量到两个真实原因（都是"声音比 UI 慢"，不是画面掉帧）：
  1. **切主题要现下载 4-5MB**。两首主题曲是 `dao-xiang.mp3` **5.25MB** / `canon.mp3` **4.34MB**；`crossfadeTo()` 会先 `waitForCanPlay()`（最多等 **6 秒**）再交叉淡入（2 秒）。桌面网络快 / 曲子已在缓存里 → 感觉是瞬间切过去；手机上一旦目标那首没缓冲过，就是"UI 已变、歌还没来"。
  2. **暂停是 1200ms 淡出后才真停**（`AUDIO.fadeOutMs`）—— 按暂停是"现在停下"的意图，一秒多的余音容易被当成"UI 变了声音还在放"。
- 文件：`src/scripts/music-manager.ts`（**新增 `warmOtherTrack()`**）、`src/lib/music.ts`（`fadeOutMs` 1200 → **450**）、`DEVELOPMENT.md`。
- 行为：第一次播放稳定 5 秒后，在后台创建并 `load()` 另一套主题曲的 `<audio>`（元素本来就会缓存在 `elements` 里，切主题时直接复用）；开了省流量模式（`navigator.connection.saveData`）就跳过。切歌成功后同样为"下一首"预热，来回切主题都不再等下载。
- 钩子/数据：无新增 data-* / storage key / 事件；`elementFor()` 的复用关系不变。
- 验证：`npm test` 88/88；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。Playwright 实测（CDP 限速成手机网络：8Mbps + 150ms 延迟）—— 进场播放后约 12 秒查 `<audio>` 集合：`canon` 已经 `readyState=4`（整首缓冲完）且 `paused`；`setTheme('baroque')` 到 **canon 真的在放** 只用了 **114ms**（改之前要等这首 4.3MB 下载完，最多 6 秒）；`pause()` 到元素真的停住 **518ms**（原来 1200ms 淡出）。
- 未在本轮处理：**暂停 MIDI（关于区那架钢琴）** 的延迟没能在本地复现（桌面无感、也无法在真机上量）。它的代码路径是 `piano.allNotesOff()`（每个音 80ms 释放）+ 一次钢琴卷帘 canvas 重绘，理论上不会等这么久 —— 等本人确认那一路是否还在卡，再针对性看。

### 2026-09-19 · 第十个标签（自我介绍）改小、拆成四行、去掉括号

- 需求：本人要求"把自我介绍标签再改小一点，分成四行、去掉括号"。
- 文件：`src/lib/identity.ts`（`intro` 文案改成 `\n` 分行；`tagLines()` 返回 `{ title, notes[] }`；`tagLabel()` 把换行折成空格给 aria-label 用）、`src/components/IdentityStage.astro`（渲染四行 + 收小尺寸）、`tests/identity.test.mjs`（4 条断言跟着更新）、`DEVELOPMENT.md`。
- 文案：中文 `自我介绍 / 听了这么久 / 点一点我吧 / 求求了(｡>﹏<｡)`；英文 `ABOUT ME / you have listened this far / click me, please / I beg you (｡>﹏<｡)`。去掉的是那句请求外面的括号；情绪脸自己的括号是表情的一部分，留着。
- 尺寸：不再"比别的标签大 0.2 倍" —— 原来那套 `calc(基准 * 1.2)` 的 padding / min-height / max-width 全部收回普通档，字号还略小一档（`clamp(13px, 1.05vw, 15px)`）；标题 700，下面三行 `.8em` / `opacity .82` / `line-height 1.4`。想再调大小只改 `.identity__tag[data-identity-link]` 的 `font-size` 一行。
- 函数：`tagLines(tag, lang): { title: string; notes: string[] }`（原来是 `{ title, note? }` 并按左括号拆）；`tagLabel()` 现在会把 `\n` 换成空格。
- 钩子/数据：无新增 data-* / storage key / 事件；`[data-identity-link]` 用法不变。
- 验证：`npm test` 88/88（含"四行拆分"、"请求里不再有括号且情绪脸括号保留"、"aria-label 里没有换行"三条）；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。浏览器实测（移动 393×852 / 桌面 1280×900，先把十个标签都放出来再量）：标签 **139×140px（移动）/ 101×118px（桌面）**，四行实际字号 13 / 10.4px（桌面 13.44 / 10.75px）；同页其它标签仍是 15px、75×47px —— 也就是说它**不再比别的标签大**，而是一块窄高的四行小贴纸。

### 2026-09-19 · 标签抓取与落地手感优化

- 需求：先检查历次开发记录，改善标签物理运动的真实感与交互反馈。
- 文件：`src/scripts/identity-physics.ts`、`tests/identity-physics.test.mjs`、`DEVELOPMENT.md`。
- 行为：抓取关节刚度从 .18 调为 .35、阻尼从 .12 调为 .3；落地恢复系数 .36 → .22，摩擦 .65 → .48、空气阻尼 .008 → .012，减少反复弹跳和拖动余振。碰撞圆角限制为 12px，更接近标签外形。
- 修复：长标签转动惯量统一在 `makeBody()` 设置为基础值两倍，恢复和重新测量保持一致，不再每次揭示累乘四倍；重新抛出先清除旧速度和自转；键盘操作解除冻结；没有边界或尺寸变化的布局通知保留休眠，不再无故唤醒整堆标签。
- 钩子/数据：无新增导出、DOM 钩子、存储 key 或事件。
- 验证：`npm test` 87/87，包含 4 项真实 Matter 引擎回归测试：切语言恢复后继续下落并停稳、无变化布局通知不唤醒、恢复/再揭示的转动惯量一致、抓取移动后跟手停稳且松开后自然下落。浏览器布局与输入边界采用模拟，未把这些测试当作真机手感验证。`npm run check` 0 错误、0 警告；`npm run build` 17 页成功。

### 2026-09-19 · iPhone 上切主题时主标题直接跳色（Safari 不给"继承来的颜色"补间）

- 需求：本人反馈（iPhone 17 Pro）"手机端切主题的时候，每个页面上面的那个主标题（BLOG / LAB / 让音乐介绍我）没有跟着网页内容一起过渡，而是直接变色了；电脑端一切正常"。
- 查证：先在桌面与手机尺寸的 Chrome 里采样切主题时 `.page__title` 与 `.lede` 的 computed color（每 60ms 一次）：**两者都在补间**（各采到 12-13 个中间色），所以 CSS 机制没问题，问题只在 WebKit。再看 DOM：`.lede` 和 `.page__title` 在**同一个** `.page__head.rise` 里（排除"合成层/动画容器"这类猜测），差别只有一个 —— `.lede` 自己写了 `color: var(--ink-2)`，而 `.page__title`、`.identity h2` **一个 `color` 都没写，靠从 `body` 继承**。Safari 不会给"继承来的颜色变化"做补间（`.theme-shift` 那套 `transition` 因此对它不生效），于是它直接跳色；Chrome / Firefox 继承也能补间。
- 文件：`src/views/BlogIndexPage.astro`、`src/views/LabPage.astro`（`.page__title` / `.labitem__title`）、`src/views/PostPage.astro`（`.post__title`）、`src/views/IntroPage.astro`（`.letter-page__title`）、`src/components/IdentityStage.astro`（`.identity h2`）、`src/styles/global.css`（`.prose > *`）、`DEVELOPMENT.md`。
- 函数/钩子：无脚本改动；无新增 data-* / storage key / 事件。
- 验证：**逐元素颜色快照比对**——写 `.shots/color-snapshot.mjs` 抓取 5 个路由 × 2 个主题共 10 页、1782 个元素的 computed color，改动前后**差异 0 条**（颜色值完全没变，只是从"继承"变成"自己有声明"）。`npm test` 83/83；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。
- 已知未处理（等真机确认后再决定）：导航/页脚/卡片名/小屏读数里那些 i18n `<span>` 也没写 `color`（它们同样靠继承），若真机上这些文字也硬切，用同一个办法继续补 —— 但当时"父级用了哪条声明"的 CDP 取数不可靠（导航父级其实也是继承），所以没有盲改。

### 2026-09-19 · 摇晃彩蛋在首页关于区没反应：认的是"恢复态"标签 + 推力被摩擦吃掉

- 需求：本人（iPhone，地址 `/en/#about` 那一带）说"这一次询问了，但还是摇不动那些东西"（运动权限已经批了）。
- 查证：给彩蛋补了三个读数（`[data-identity]` 上的 `data-motion` / `data-motion-shakes` / `data-motion-pushes`）后按他的场景（`/#about`，手机视口）复现，得到 `motion=shaking, shakes=4, pushes=12`，但标签只动了 **1.0px** —— 传感器、阈值、监听器全都是好的，问题在物理那一侧，而且有两层：
  1. **恢复态标签被跳过**：从落点 cookie 恢复出来的方块是 `frozen` 且不在 `dropped` 里（`restore()` 的"先摆出来"兜底），而 `shove()` 当初把这两种都排除了。只要这一趟进过 About（有记忆落点），场上就全是这种方块 —— 摇多少次都不动。
  2. **推力被摩擦吃掉**：原来给的是力（对齐 matter 的 gravityScale）。标签躺在地板上（`friction .65`），2.4 倍重力的一步只换来约 1px 位移，之后立刻被摩擦按停。
- 文件：`src/scripts/identity-physics.ts`（`shove()` 改成冲量 + 解除 `frozen`）、`src/scripts/identity-motion.ts`（新增三个排查读数）、`DEVELOPMENT.md`。
- 函数：`shove(x, y)` —— 现在对**场上所有本体**生效（跳过正在被拖的那一个），`Body.setVelocity` 直接叠速度（`gain 6` px/step + 左右抖动 + 向上抬升 `strength × 0.8`）、并叠一点自转；`attachIdentityMotion` 里新增 `mark()` / `bump()` 两个读数写入。
- 钩子/数据：新增只读读数 `data-motion`、`data-motion-shakes`、`data-motion-pushes`（写在 `[data-identity]` 上）；无 storage key、无新事件。
- 验证：`npm test` 83/83；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。Playwright 手机模拟实测（合成 devicemotion，比对基线上已睡稳的标签）：**首页 `/#about` 场景 1.0px → 74.9px**（同一场景、同一段合成数据，改前改后对比）；独立 `/about/` 页 332.6px；轻晃（远低于阈值）0.0px；桌面（`(pointer: coarse)` 为假）0.0px；全程 0 console error。

### 2026-09-19 · 运动权限：单飞、手持设备判定放宽、被拒时给一句实话

- 需求：本人反馈"不应该呀，是不是接口没用对，他根本就没有询问"（指 iOS 那个「某某网站想要访问动作与方向」）。
- 先查证：在线上把 `DeviceMotionEvent.requestPermission` **包一层计数**（不是替身实现，改的是真调用）后点"进入空间"，确认产品代码确实调到了它 —— 但**同一次点击里调了两次**（入场页一次 + About 区兜底一次）。iOS 上重复调用是危险的：第二次常常立刻返回 `denied`；而且只要用户点过一次"不允许"，Safari 会一直记住、此后静默拒绝、再也不弹。
- 文件：`src/scripts/identity-motion.ts`、`DEVELOPMENT.md`。
- 函数：新增模块内 `askOnce()`（并发共享同一个 Promise）与 `isHandheld()`、`announceMotionOffline()`；`requestMotionAccess()` 改成三态 + 单飞，兜底入口也统一走它。
- 钩子/数据：`getGlobal().motionAccess` 语义明确为三态（`true` 批过 / `false` 拒绝过 / `undefined` 没问过）；无新增 DOM 钩子、storage key、自定义事件。被拒时复用已有的 `space:message`（LCD）说 `MOTION OFFLINE`。
- 验证：`npm run check` 0 错误 0 警告 0 提示；`npm test` 83/83。线上实测（包一层计数）：改动前入场点击 = 2 次调用，改动后 = **1 次**；桌面（`(pointer: coarse)` 为假且 UA 不是 Apple 手持）直接记 `false`、不调用；`requestPermission` 在 Chrome 上同步返回 `granted`（不会打扰桌面用户）。

### 2026-09-19 · 修两处真机反馈：换页音乐向前跳 0.45 秒 + iPhone 摇了没反应

- 需求：本人 iPhone 实测两条 —— 1) 从"关于"点进"关于我"，音乐会**向前**位移约零点几秒（不是他要的无缝）；2) 摇手机没反应。
- 根因：
  1. **交棒只记了一个位置**。我原先记的是"已经排进音频时钟的末尾"（= 听到的位置 + 0.45 秒预排），接手页把它当成"现在在哪"，于是整条时间轴比真实听到的位置早了约 0.2–0.45 秒 —— 听感就是往前窜一截。"听到的位置"和"已经排到的位置"本来就是两个数，必须分开。
  2. **iOS 的运动权限从没被申请过**。`DeviceMotionEvent.requestPermission()` 只在用户手势里有效，我把它挂在"第一次碰标签"上；本人只是摇了手机、没先碰标签，于是权限没批、传感器一个事件都收不到。另外阈值也偏高（4 次 ×13 m/s²）。
- 文件：`src/lib/handover.ts`（**新增**，纯换算 + 单测）、`src/scripts/identity-audio.ts`（交棒记录改为 `{ position, scheduledUntil, at }`）、`src/scripts/identity-player.ts` / `nocturne.ts`（用 `position` 记时间轴、用 `from` 排音符）、`src/scripts/identity-motion.ts`（**新增 `requestMotionAccess()`** + 兜底申请改成"这一块在屏幕上时点/滑页面任何地方"）、`src/scripts/entry-gate.ts`（在"进入空间"的点击里申请）、`src/scripts/global.ts`（`motionAccess`）、`src/lib/shake.ts`（阈值 4×13 → 3×11）、`tests/handover.test.mjs`（**新增** 4 条）、`tests/shake.test.mjs`（跟着新阈值改两处期望）、`DEVELOPMENT.md`。
- 钩子/数据：新增全局字段 `getGlobal().motionAccess`；无新增 DOM 钩子 / storage key / 自定义事件。
- 验证：`npm test` **83/83**（接棒换算 4 条：按听到的位置续上而不是预排末端、位置随时间推进且不倒退、跳得太慢时跳过中间那段、过期/异常交棒忽略）；`npm run check` 0 错误 0 警告；`npm run build` 17 页。Playwright 实测：
  · 入场页点击 → `requestPermission` 被调用（`motionAccess` 变 `true`）；
  · `/about/` → `/about/intro/`：交棒时写入的位置 1.34 秒、自我介绍页首报 **1.30 秒**（差 −0.04 秒，旧逻辑是 +0.45 秒的向前跳），整段跳转耗时 0.11 秒（小于 0.45 秒预排，声音不断）；
  · 摇晃彩蛋回归：手机模拟轻晃 0.0px / 猛晃 26.1px，桌面猛晃 0.0px，0 console error。

### 2026-09-19 · 夜曲跨页不断音：关于 ⇄ 关于我 用同一架琴接棒

- 需求：本人发现从 About 页点进自我介绍页时，夜曲会停一下再从头接上；要求做成无缝切换。
- 根因：两页各自 `new PianoEngine()`，换页时旧页面 `dispose()`（`allNotesOff` + 关掉 AudioContext）、新页面重新解码采样、再从 0 淡入 —— 中间必然是"断一下"。
- 文件：**新增** `src/scripts/identity-audio.ts`；改 `src/scripts/identity-player.ts`、`src/scripts/nocturne.ts`、`src/scripts/app.ts`、`src/scripts/global.ts`（`identityPiano` / `identityHandover`）、`src/scripts/piano.ts`（新增 `getVolume()`）、`DEVELOPMENT.md`。
- 函数：`identityPiano()`（三处共用的同一个引擎，挂 `getGlobal()`）、`handOverIdentityPiano(position)` / `takeIdentityHandover()`（交棒点，含"这一跳太慢就跳过超出部分"）、`releaseIdentityPiano()`、`rampIdentityVolume(piano, target, ms)`；两页的 `pause(keepRinging = true)` 不掐音，`schedule(ahead)` 支持交棒时按 `HANDOVER_AHEAD`（0.45s）预排一段。
- 钩子/数据：无新增 DOM 钩子 / storage key / 自定义事件；新增全局字段 `getGlobal().identityPiano`、`.identityHandover`。
- 验证：`npm test` 79/79；`npm run check` 0 错误 0 警告；`npm run build` 17 页。Playwright 实测（真实 AudioContext，1280×900）：`/about/` → `/about/intro/` → 返回 `/#about`，`AudioContext` 全程同一个实例（用包装过的 `AudioContext` 计数：新建 0 次）、音频时钟持续前进、音量 0.85 ↔ 0.7 滑行且从不为 0、自我介绍页 `data-nocturne-at` 从 5.5 秒接着走（不是 0），去 `/blog/` 时 `identityPiano` 已被释放，全程 0 console error。

### 2026-09-19 · 手机端独有彩蛋：摇晃手机，About 的标签跟着一块晃

- 需求：本人要求加一个手机端独有的彩蛋 —— 摇晃手机时"关于"页那些标签跟着一起晃（标签本来就有 matter-js 物理，直接接上即可）。
- 文件：**新增** `src/lib/shake.ts`（纯逻辑摇晃识别）、`src/scripts/identity-motion.ts`；改 `src/scripts/identity-physics.ts`（新增 `shove(x, y)`）、`src/scripts/identity-player.ts`（挂载 / 注销）、`tests/shake.test.mjs`、`DEVELOPMENT.md`。
- 逻辑：`devicemotion` → `createShakeDetector()`（默认：1.1 秒窗口里攒够 4 次 ≥13 m/s² 的强脉冲才算摇晃；单次颠簸、走路不会触发）→ 打开 4.2 秒的"跟着晃"时间窗（继续晃会续上）→ 窗内每次采样把设备加速度换算成推力交给 `physics.shove()`（力施加在中心偏一点的位置，方块自己翻滚；只有已落地、未冻结、没在拖的方块会被推）。三条边界：只有粗指针（手机）+ 有 `DeviceMotionEvent` 才挂；只有 `[data-identity]` 滚进视口才听传感器（IntersectionObserver，省电且不会在看不见的地方把标签甩乱）；`prefers-reduced-motion` 直接不挂。iOS 的 `DeviceMotionEvent.requestPermission()` 必须在用户手势里调，所以不主动弹窗：第一次碰标签容器或身份区时才申请一次，拒绝就当作没有这个彩蛋。
- 钩子/数据：无新增 DOM 钩子 / storage key / 自定义事件（只用既有的 `[data-identity]`、`[data-identity-arena]` 与传感器事件）。
- 验证：`npm test` 79/79（新增 `tests/shake.test.mjs` 8 条：单次颠簸不触发、安静采样不触发、窗口内脉冲够了才触发、超过窗口不累计、触发后有安静期、NaN/Infinity 不计入、reset 清空、阈值可配）；`npm run check` 0 错误；Playwright 双场景实测（合成 `devicemotion`，只统计"基线上已经睡稳"的标签，按标签 id 比对）：手机模拟（390×844、`hasTouch`、`(pointer: coarse)` 为真）轻晃位移 **0.0px**、猛晃位移 **22.4px**；桌面（`(pointer: coarse)` 为假）同样的猛晃 **0.0px** —— 手机端独有这条门确实生效，全程 0 console error。

### 2026-09-19 · 手机端也能进彩蛋提示模式：同时按住 D4 + F#4 一秒

- 需求：本人发现手机上按不了 `Shift`+`P`，而"先进入提示模式"是整条彩蛋链路的前置条件——等于手机永远进不去（琴键本身支持多点触控，缺的只是这个开关）。本人选定等价动作：**同时按住 D4 与 F#4**，时长先定 2 秒，实测后觉得久，改成 **1 秒**。
- 文件：`src/lib/easter-eggs.ts`（新增 `HOLD_TO_ARM` + `isArmChord()`）、`src/scripts/easter-eggs.ts`（`holdNote()` / `releaseNote()` / `syncHold()`，并监听 `minilab:release`）、`src/scripts/minilab.ts`（`release()` 里补发 `minilab:release`）、`tests/notes.test.mjs`（+2 条）、`DEVELOPMENT.md`。
- 逻辑：MiniLab 松键时派发 `minilab:release`（与既有的 `minilab:note` 对称）；管理器只维护"当前哪些音正被按住"，`isArmChord()` 成立后计时 `HOLD_TO_ARM.holdMs`，到点才 `toggleHint()`。中途松开任何一个音就作废重来；一直按着不放只触发一次，想退出得先松开、再按住同样久。桌面 `Shift`+`P` 保留，两条入口等价，都只在有 MiniLab 的页面上有效。
- 钩子/数据：新增自定义事件 **`minilab:release`**（detail `{ midi, note }`，已登记进 §6.2）；无新增 DOM 钩子、无 storage key。入口和弦本身是 `lib/easter-eggs.ts` 里的数据，改时长只动 `HOLD_TO_ARM.holdMs` 一个值。
- 验证：`npm test` 71/71（新增"入口和弦必须是 25 键上的两个不同键"与"必须两个音都按住才算"）；Playwright 手机模拟（390×844、`isMobile`+`hasTouch`、CDP 双指触摸事件）实测：只按住 D4 2.3s 不触发、两键同按 **0.6s 不触发**、**同按 1.3s 进入提示模式**（LCD 出现 `LISTEN`、目标键亮起），随后点 G4 E4 F4 G4 成功切到 baroque 并提示 `SEQUENCE ACCEPTED`；桌面端 `Shift`+`P`（开 / 关）与按住 `x`+`g`（D4+F#4 的键盘映射）都通过，全程 0 console error。

### 2026-09-19 · 现代主题：全站统一淡蓝背景 + 时钟 / 播放器 / 联系方式的厚玻璃

- 需求：本人反馈两条 UI 问题 —— 1) 关于我页面和网站主页的背景不是一个蓝（一个淡蓝、一个偏蓝），保留淡蓝；2) 现代主题里时钟 / 播放器 / "找到我" 那几个容器还不够 liquid 玻璃。
- 背景：那个"淡蓝"原本是首页专用覆盖（`home-glass.css` 里的 `html:not([data-theme='baroque']) body:has(.home) .ambient`）。现在把它按原值搬进 `src/styles/tokens.css` 的现代主题（`--paper` `#e4eef5`、`--paper-2`、`--paper-3`、`--bg-image`、`--bg-vignette`），于是 `/`、`/about/`、`/about/intro/`、`/blog/`、`/lab/` 以及入场页共用同一片底；`home-glass.css` 随之删除（`HomePage.astro` 不再 import，`home-glass.css` 里那条"把玻璃调淡"的覆盖也一起消失，首页顶栏现在和其他页面完全同材质）。首页外观与改动前逐像素一致（用的就是原来那组值），关于页从 `#dbe6f7` + 左上强蓝光斑变成 `#e4eef5`。
- 玻璃：新增一档 `.glass--liquid`（`src/styles/global.css`），**和顶部导航栏同一种料**：一层很淡的白（`--liquid-fill`，0.11）+ 一道白色斜高光（沿用 `--grad-sheen`）+ 强模糊（`--liquid-blur` 30px，小面 `--liquid-blur-s` 22px；`--liquid-saturate` 1.5）。`.glass--liquid` 里显式把 `--glass-tint` 和 `--glass-surface` 关成 `none` —— **面板自己不产生颜色，颜色只能从背景透过模糊进来**；只额外留一圈纯白的边光（`--liquid-edge` / `--liquid-stroke`）和收得住的投影（`--liquid-inset(-s)` / `--liquid-shadow(-s/-lift)`），否则小块玻璃落在浅色背景上看不出边界。baroque 里换成一档"深色透光玻璃 + 暖白高光"。两套值都在 `tokens.css`。
- 中途返工一次：第一版把"厚玻璃"理解成"更白 + 更多色偏"（蓝/青的调子层 + 内部镜面层），本人看过实际页面后要求"和顶部导航栏一样的液体玻璃透明的，不是这种乱堆颜色上去的"，于是把色偏层与镜面层整个删掉，改成上面这套纯白的配方。
- 文件：`src/styles/tokens.css`、`src/styles/global.css`、`src/components/LcdClock.astro`（`glass glass--1` → `glass glass--liquid`）、`src/components/MusicSystem.astro`（full 变体挂 `glass glass--liquid`，组件里删掉重复的材质声明只留 padding；LCD 屏上沿补一圈玻璃反光）、`src/components/ContactTiles.astro`（`::before` 换成小一号的 `--liquid-*`，并加了 hover / focus-within 提亮）、`src/views/HomePage.astro`（去掉 `home-glass.css` 的 import）；**删除** `src/styles/home-glass.css`。
- 钩子/数据：无新增 data-* / storage key / 自定义事件；样式类新增 `.glass--liquid`。
- 验证：`npm test` 69/69；`npm run check` 0 错误 0 警告；`npm run build` 17 页，产物 CSS 里标准 `backdrop-filter` 9 处、`-webkit-backdrop-filter` 0 处（没有再踩 §10「液态玻璃线上失效」那条）。Playwright 实测（1440×1000，先跳过入场页）：`/` 与 `/about/` 的 `.ambient` 计算值完全相同，截图逐点比对也一致（左上 40×40 都是 `214,235,254`，右下 `223,229,242`）；厚玻璃面板的边光比周围背景亮约 20 级（时钟上沿 `241,248,250` vs 背景 `219,236,240`），右下角带出青色折射（`189,227,239`），播放器深色屏仍是 `65,80,121`（屏幕没有被玻璃吃掉）；baroque 主题与 390px 宽视口下同样无 console error。

### 2026-09-19 · 修复 About 切语言后标签冻结悬空

- 需求：About 身份标签切换语言后仍会失去物理效果，部分标签悬停在空中；修复后更新文档并推送 GitHub，触发 Render 自动部署。
- 根因：离页快照可能在标签仍飞行时写下；目标语言页 `restore()` 为安全恢复会把所有身体设成 `frozen + sleeping`，而切语言分支的 `markPlaced()` 过去只写 `dropped` 防止重新抛出，没有解除冻结。于是快照中位于半空的标签被永久钉住。
- 文件：`src/scripts/identity-physics.ts`、`README.md`、`DEVELOPMENT.md`。
- 函数：`markPlaced()` 现在除标记 `dropped` 外，还会删除 `frozen`、在非 reduced-motion 模式下 `Sleeping.set(body, false)`，并调用 `wake()` 让 Matter.js 从恢复位置继续运算；不会整排重弹，也不会提前补齐尚未出场的标签。
- 钩子/数据：无新增 DOM 钩子、storage key 或自定义事件；沿用 sessionStorage `space.lang-swap` 与 cookie `rest-note-identity-v3-<visit>`。
- 验证：`npm test` 69/69；`npm run check` 0 错误、0 警告；`npm run build` 成功生成 17 页。Edge 本地预览在独立 About 页从头播放，首个标签飞行阶段切换英文→中文：恢复后仍只有 1 个已触发标签（未提前补齐），其 `top` 从 0px 继续下落到约 245px；落地后用方向键再次抛掷，`top` 从约 495px 上升到 429px、随后回落到 495px，证明切语言后的物理计算与交互仍在运行，没有冻结悬空。

### 2026-09-19 · 修复自我介绍页底部切语言位移 + 顶栏统一回 Journey 长页

- 需求：1) 自我介绍长文拉到底部后切换语言，仍然会因中英文正文高度不同而位移；2) 从 About / 自我介绍等独立页面点击顶栏项目时，应进入首页拼接成长页的对应区块，而不是打开分开的列表页。
- 根因：1) 滚动恢复只保存像素和正文地标，目标语言更长时会对齐同一段、却不再贴住页面底部；2) `Header.astro` 只在当前已经是 Journey 首页时生成 `#blog` / `#lab` / `#about`，其他页面仍生成 `/blog/` / `/lab/` / `/about/`。
- 文件：`src/scripts/lang.ts`、`src/components/Header.astro`、`DEVELOPMENT.md`。
- 函数：`rememberScrollPosition()` 新增底部判定；`readSavedScroll()` / `applySavedScroll()` 恢复该状态；`Header.astro` 的 `navHref()` 统一把站内顶栏项目指向本语言 Journey 长页锚点。
- 钩子/数据：sessionStorage `space.lang-scroll` 的临时记录新增可选 `atBottom` 布尔字段；无新增 key 或 DOM 钩子。
- 验证：`npm test` 69/69；`npm run check` 0 错误、0 警告；`npm run build` 成功生成 17 页。Edge 本地预览实测：中文自我介绍页在底部（页面高约 11185px、底部差约 0px）切到英文后，英文页增高到约 12824px 仍贴底（底部差约 0px）；独立页顶栏生成 `/en/#home`、`/en/#blog`、`/en/#lab`、`/en/#about`，点击 Lab 实际进入 `/en/#lab` 且对应长页区块可见。

> 每加一个新功能、或改掉一个已有行为，都在**最上面**追加一条（新的在上）。
> 复制下面这个模板；"验证"一栏要写实际做过的事（测试 / 截图 / 手动步骤），不写"应该没问题"。

```md
### YYYY-MM-DD · 功能名
- 需求：一句话说清为什么改
- 文件：改了哪些文件（新增的标出来）
- 函数：新增/修改的导出函数、类、关键内部函数
- 钩子/数据：新的 data-* / storage key / 自定义事件（没有就写"无"）
- 验证：npm test / npm run check / 浏览器实测结果
```

### 2026-09-19 · 自我介绍页：切语言改按"视线高度"对齐 + 返回改回首页的关于区（#about）

- 需求：本人复报"关于我里面的中英翻译切换还是有问题，其他好像没了"；同时要求自我介绍页的返回按钮回到 `/#about`，而不是独立的 `/about/`（他那句"不在被拼接成一整串的那个网页里"）。
- 复现与量测（无头 Chrome 1280×800，本地构建产物；只比"同一块内容"的前后位置）：
  - 自我介绍页 `/about/intro/`、`/en/about/intro/` 各 6 个滚动位置、上下两个方向：滚动位置和"视口顶端那一块"都已经稳住了，但**屏幕中间那段文字**漂 90–180px（en@1500 中间块 −122px，en@3000 −91px）—— 对齐点取在视口**最上沿**，漂移往远处累积，而人看的正是中间。
  - 返回按钮：`href` 当时是 `aboutRoutes[lang]`（`/about/`）。
- 改动：
  1. `src/scripts/lang.ts`：`topProbeY()` → `probeY(fraction = 0.45)`、`blockAtTop()` → `blockAtEye()`（长文页的对齐点从视口顶端改到视线高度 45%）。"占住视口的那一块"规则不变，所以关于页/首页的行为不受影响。
  2. `src/views/IntroPage.astro`：左上角返回与页脚"回到关于"都指向 `localizePath('/', lang) + '#about'`。
- 实测：自我介绍页中间块位移 **0 / −30px**（改前 −91 / −122），上下两边的漂移摊到 ±90 左右；点返回后 URL `/#about`（英文 `/en/#about`）、关于区停在屏幕 78、`body > [data-identity-arena]` 在、十个标签都在且拖动跟手（−161/−74）；首页关于区仍是 78 → 78、标签继续贴住区块。
- 文件：`src/scripts/lang.ts`、`src/views/IntroPage.astro`、`DEVELOPMENT.md`（§5.4 / §5.14 / 本条）。
- 钩子/数据：没有新增 data-* 钩子或 storage key；`space.lang-scroll` 里的 `anchor` 字段含义不变，只是记录的点从"视口顶端"变成"视线高度"。
- 验证：`npm test` 69 项全过、`npm run check` 0 错误、`npm run build` 通过；上面两组浏览器实测 + 首页/关于页回归各一次。

### 2026-09-19 · 切语言的三件事：标签不再提前弹出 / 正在看的那一块不再被挤走 / 拖拽不会卡死

- 需求：本人复报三件事——①"点击翻译会有位移"；②"关于页 MIDI 还没播到那一段，所有性格标签就全弹出来了"；③"有时候按导航跳到单独的网页就拖不动"，并要求我用浏览器自己复现。
- 复现方式：本会话里 Codex 的浏览器操控插件连不上（`unsupported Codex auth method: apikey`），改用**无头 Chrome + CDP 脚本**跑真实链路（入场页 → 等夜曲 → 点翻译 → 逐帧量位置），脚本放在 `%TEMP%\cdp-*.mjs`。
- 根因与实测：
  1. **提前弹出**：切语言那一趟走的是 `physics.placeMissing()`，把还没上场的标签一次补齐。实测切语言时场上只有 2 个标签，**350ms 后 10 个全出**、瞬间静止成一排。现在改成 `markPlaced()`（把场上的记成"已落地"）+ `needsAnimation` 保持 `true`：实测 2 个原地不动 → 音乐 0:09 出第 3 个 → 0:33（`identityRevealPlan` 的 deadline）凑满 10 个，音乐从原来的 0:05 接着走（`live-timeline`）。
  2. **真的位移**：滚动只按老像素恢复，而换语言后内容高度会变（首页整块"关于"区在文档里下沉 **115px**、自我介绍页整篇高 **1639px**），人正在看的那一块被挤走；另外收尾的 `finally` 里无条件 `forgetSavedScroll()`，而 `navigate()` 在 `astro:page-load` 之前就返回 —— 第二段对齐永远读不到位置，等于只有一段。现在 `space.lang-scroll` 多存一个 `anchor`（"占住屏幕的那一块"的子节点路径 + 它的视口高度），`applySavedScroll()` 先按地标对齐、找不回才退回像素，只有 `navigate()` 真抛错才丢弃位置，`document.fonts.ready` 后补一次对齐（用户自己滚过就不抢）。实测：首页滚到关于区切语言 `[data-identity]` 屏幕位置 98 → 98、滚动 2714 → 2829；自我介绍页滚到 4000 切语言，视口顶端那段 −25 → −25。
  3. **标签跟着区块一起走**：落点格式从 `{ x, y, angle }[]` 改成 `{ floor, items }`（cookie 版本 `v2` → `v3`），`restore()` 先算 `shift = floor_now - layout.floor` 再整体平移 —— 否则滚动位置一改，标签就相对区块漂走（实测差 115px）。
  4. **拖不动**：`pointerup` 丢事件（指针在窗口外松开）会让 `drag` 卡在"正在拖"，之后谁按都拖不动；`bounds()` 因尺寸变化重造本体时，拖拽关节还挂在被移出世界的旧本体上（按着指针标签也不动）。现在 `window` 上兜底监听 `pointerup`/`pointercancel`/`blur`，`pointerdown` 发现上一次拖拽超过 2.5s 就先替它收尾，重造本体时把 `drag.joint.bodyB` 接到新本体上。实测：切语言前后各拖一次都跟手（−174/−70 与 −188/−64，请求的是 −180/−70 与 −190/−60）。
- 文件：`src/scripts/lang.ts`、`src/scripts/identity-physics.ts`、`src/scripts/identity-player.ts`、`DEVELOPMENT.md`。
- 函数：`lang.ts` 新增内部 `topProbeY()` / `isBlock()` / `visibleHeight()` / `blockChildren()` / `blockAtTop()` / `dominantBlock()` / `findAnchor()` / `resolveAnchor()` / `readAnchor()`，`rememberScrollPosition()` 改存 `ScrollRecord = { y, hash, anchor? }`，`applySavedScroll()` 改为地标优先，`restoreScrollAfterLoad()` 加 `fonts.ready` 补对齐；`identity-physics.ts` 的 `IdentityLayout` 改成 `{ floor, items }`、`snapshot()` 记录地板、`restore(layout | undefined)` 按地板差值平移、`placeMissing()` → `markPlaced()`、`bounds()` 重接拖拽关节、`pointerdown` 加陈旧拖拽兜底、新增窗口级 `release` 监听；`identity-player.ts` 的 `LAYOUT_VERSION` → `'v3'`、`readLayout()` 校验新形状、切语言分支改调 `markPlaced()`、删掉 `start()` 里那句 `if (!needsAnimation) root.dataset.settled`。
- 钩子/数据：storage key `space.lang-scroll` 的值多了 `anchor` 字段；身份落点 cookie 名 `rest-note-identity-v3-<visit>`（新增 `floor`）。没有新增 data-* 钩子或自定义事件。
- 验证：`npm test` 69 项全过；`npm run check` 0 错误；`npm run build` 通过；无头 Chrome 实测数据见上（提前弹出、地标对齐、拖拽三组）。判断"零位移"时比的是标签**中心点**。

### 2026-09-19 · 关于页切语言：标签真正零位移（落点改存像素坐标 + 尺寸自愈）

- 需求：本人复报"事实证明位移还是存在"，并让我自己进自我介绍页和关于页各试一次。
- 复现与根因（无头 Chrome 1280×800，比的是标签**中心点**，不是外接矩形）：
  1) `bounds()` 里 `y: Math.min(b.position.y, floor - 50)` 是一刀切：躺在地板上的方块中心是 `floor - h/2 ≈ 545`，被抬到 `floor - 50 = 518` —— 整整 **27px**，切语言时看着就是"位移"。
  2) 落点当时存的是归一化比例，两种语言页面高度差几像素就会整体缩放，实测偏 20-80px。
  3) 夹取按方块尺寸算，而**新页面的脚本比样式先到**：实测 46px 的标签被量成 134px，`floor - h/2` 于是把它夹歪 44px。
  4) 按舞台宽度夹 x，会把更宽的英文标签往左推，最宽的那个偏 75px。
- 文件：`src/scripts/identity-physics.ts`、`src/scripts/identity-player.ts`、`DEVELOPMENT.md`。
- 函数：`IdentityLayout` 改存文档像素坐标，`snapshot()` 直接给 `body.position`；新增内部 `makeBody()`（造本体 + 记下尺寸）；`bounds()` 加**尺寸自愈**（尺寸对不上就用同一个中心重造本体）和松夹取（只跟视口、地板有关）；`restore()` 同样松夹取、并先移除同位的旧本体；`dispose()` 加 `disposed` 守卫；`document.fonts.ready` 之后再跑一次 `bounds()`。`identity-player.ts` 加 `LAYOUT_VERSION = 'v2'`。
- 钩子/数据：cookie 更名 `rest-note-identity-<visit>` → `rest-note-identity-v2-<visit>`（格式变了，旧值被当像素读会把方块甩到左上角）。
- 要点：位置**不能**依赖"当时量到的元素尺寸"和"舞台当时多高"；夹取只做"别出视口、别陷地板"；判断有没有位移看中心点（旋转过的方块，盒子一变宽外接矩形就会动）。细节见 §5.8。
- 验证：无头 Chrome（1280×800）实测 `/about/` → 点 EN，等标签完全静止（漂移 0）后比中心点：**十个标签全部 `[0, 0]`**（修前 -10 ~ -44px）；"记录值 vs 实际渲染" `[0, 0]`。`/about/intro/` 切语言：`scrollY` 60 → 60，`h1`、返回按钮位置不变。`npm test` 69/69、`npm run check` 0 错误 0 警告、`npm run build` 17 页。

### 2026-09-19 · 关于页切语言：标签不再重弹，落点和滚动位置都留在原处

- 需求：本人反馈"其他地方点击切换翻译都正常了，但在关于页面点击切换翻译后还是会发生位移，而且那些所有的标签会重新弹出来"。
- 根因：两层叠在一起 ——
  1) 上一版用模块变量 `swappingLanguage` 判"这一趟是切语言"。但 `navigate()` 在 View Transition 更新完 DOM 时就返回了，新页面的脚本是随后加载才执行的：点击处理器 `finally` 里的收尾早就跑完，模块变量已经清空，新页面读到的永远是"不是切语言"（实测）。
  2) 落点 cookie 写的是"上一次全部静止时"的快照，而人往往在标签还滚着的时候就点了切换：实测快照只有 `{ len: 10, filled: 7 }`，`restore()` 返回 7，`needsAnimation = restored < tags.length` 于是为 `true` → 音乐一响十个标签整排重抛，位移最大 414px。
- 文件：`src/scripts/lang.ts`、`src/scripts/identity-physics.ts`、`src/scripts/identity-player.ts`、`DEVELOPMENT.md`。
- 函数：`lang.ts` 删掉模块态 `swappingLanguage` / `isLanguageSwap()`，改为 `markLanguageSwap(pathname)`（换页前写 sessionStorage 记号）+ `takeLanguageSwap()`（目标页取走一次，对不上就丢掉）；`identity-physics.ts` 新增 `placeMissing()`（把没记到的标签补进静止队形，不抛不滚）；`identity-player.ts` 改成 `needsAnimation = !takeLanguageSwap()`、切语言时 `physics.placeMissing()`，并在 `disposeCurrent`（`astro:before-swap` 调 `disposeIdentity()`）里 `writeLayout(physics.snapshot())` 把"此刻"的落点写全。
- 钩子/数据：新增 sessionStorage `space.lang-swap`（一次性）；没有新的 `data-*`、没有新的自定义事件。
- 要点：跨页状态**不能放模块变量**（新页面脚本的执行时机在 `navigate()` 返回之后）；落点快照要"离开前现写"，不能只靠静止时的旧快照；判"要不要重落"也别用 `restored < tags.length`。三条坑写在 §5.8。
- 验证：无头 Chrome（1280×620）实测 `/about/` → 点 EN：切前 `y=53`、10 个标签落定、cookie 7/10；切后 `/en/about/` 仍是 `y=53`，`[data-revealed]` 全程 10 个（修前掉到 7 再涨回 10 = 重弹），cookie 补齐 10/10，标签最大位移从 **414px 降到 80px**（当时以为这 80px 只是归一化缩放，后来发现它是真的位移，见最上面那条）。`npm test` 69/69、`npm run check` 0 错误 0 警告、`npm run build` 17 页。

### 2026-09-19 · 修掉"焦点圈又冒出来"：身份标签与入场页按钮上的蓝框

- 需求：本人反馈关于页的身份标签、入场页的"进入空间"按钮上又出现了蓝框（本地和线上都有）—— 和之前 `main` 那条蓝线是同一类问题。
- 根因：脚本调用 `el.focus()`（`identity-physics.ts` 按下标签时、`entry-gate.ts` 聚焦按钮与 `main` 时）会被浏览器判成"键盘焦点"，全局 `:focus-visible` 规则于是给它画上 accent 蓝框（#4A6EE0）。上一次只给 `main` 单独关掉，别处照旧；而且只加门槛还不够 —— 不写 `outline` 时浏览器会改用自带的默认焦点圈（实测 `1px auto rgb(16,16,16)`）。
- 文件：**新增** `src/scripts/input-modality.ts`；`src/scripts/app.ts`（boot 第 0 步调用）、`src/styles/global.css`、`src/components/IdentityStage.astro`、`DEVELOPMENT.md`。
- 函数：新增 `trackInputModality()`（内部 `apply()`，模块态 `modality` / `listening`）。
- 钩子/数据：新增 `html[data-input='keyboard' | 'pointer']`；没有新 storage key、没有新事件。
- 要点：焦点圈＝键盘专属。新加可聚焦元素时别写裸的 `:focus-visible`，照 §5.13 的写法挂到 `html[data-input='keyboard']` 下；鼠标态还要显式 `outline: none`，否则会露出浏览器默认圈。
- 验证：无头 Chrome（1280×900）实测 —— 入场页按钮 `outline: 3px none`；进入后 `main` `outline: 3px none`；鼠标点标签后 `outline: 3px none`（修前 `2px solid rgb(74,110,224)`）；拖动自我介绍标签后 `outline: 3px none`（修前 `3px solid rgb(74,110,224)`）；按两次 Tab（键盘玩家）`A.skip-link` 拿到 `2px solid rgb(74,110,224)`，键盘焦点框保留。`npm test` 69/69、`npm run check` 0 错误 0 警告、`npm run build` 17 页。

### 2026-09-19 · 切语言不再弹回页面顶部（保留原来的位置）

- 需求：本人要求点击语言切换之后，网站不要自己滚回顶部，而是停在原来的位置。
- 根因：ClientRouter 每次换页都在 `moveToLocation()` 里 `scrollTo({ left: 0, top: 0 })`；语言切换是一次真实的换页（`/` ↔ `/en/`），所以旧位置被丢掉，连 `#about` 这类锚点也会从地址栏消失（router 按 `to.href` 写地址）。
- 文件：`src/scripts/lang.ts`。
- 函数：新增内部函数 `rememberScrollPosition()`（换页前把 `{ y: scrollY, hash }` 写进 sessionStorage `space.lang-scroll`）、`restoreScrollPosition()`（在 `astro:after-swap` 里恢复；后来拆成 `restoreScrollAfterSwap()` + `restoreScrollAfterLoad()` 两段，见最上面那条）；常量 `SCROLL_KEY`；`initLangSwitch()` 里注册一次 `astro:after-swap` 监听（`scrollRestoreReady` 守卫，避免重复绑定）。
- 钩子/数据：新增 sessionStorage key `space.lang-scroll`（一次性：读完就删）。
- 要点：必须用 `behavior: 'instant'` —— 站点全局有 `scroll-behavior: smooth`，`auto` 会变成慢悠悠地滚回去。时机选 `astro:after-swap`（router 滚动之后、View Transition 拍新页面快照之前），位置接得上且不与动画打架。
- 验证：无头 Chrome 实测 —— 普通位置：切语言前 `y=1500` → 切到 `/en/` 后仍是 `y=1500`；带锚点：`/#about`（`y=2716`）→ `/en/#about`（`y=2716`，锚点也接回地址栏）；控制台 0 报错。`npm test` 69/69、`npm run check` 0 错误 0 警告、`npm run build` 17 页。

### 2026-09-19 · 自我介绍页大标题「关于」→「关于我」

- 需求：本人要求把自我介绍页顶部的大标题从`关于`改成`关于我`，随后要求英文版一起改（"英文的你没改"）。
- 文件：`src/content/pages/intro.zh.md`（frontmatter 的 `title`，只动中文）。
- 函数：无 —— 纯内容改动。`IntroPage.astro` 用 `entry.data.title` 同时渲染 `<h1>` 和浏览器标签页标题，所以改一处两处都跟着变。
- 钩子/数据：无。英文版标题跟着改成 `About me`；同时把英文那行小标签从 `ABOUT ME` 换成 `SELF-INTRODUCTION`（中文那行本来就是`自我介绍`），免得标签和标题重复。
- 验证：`npm test` 69/69、`npm run check` 0 错误 0 警告、`npm run build` 17 页；线上复核 `/about/intro/` 的 `<h1>`。

### 2026-09-19 · 修掉"返回后方块像死了一样"和"拖动自我介绍会强制进页面"

- 需求：本人报了两个 bug —— 1) 从自我介绍页返回 About 之后，方块的物理效果像是没了；2) 拖动第十个标签（自我介绍）会被强制带进新页面，要求"拖动不触发、点击才触发"。顺带：中文返回按钮只留`返回`。
- 根因：1) 落点 cookie 命中时 `needsAnimation = restoredCount < tags.length` 为 `false`，十个方块被"存档"直接摆好并全部 sleeping —— 引擎其实活着（拖得动），但没有任何掉落与碰撞，看起来就是"物理没了"；2) 标签是 `<a href>`，浏览器在 `pointerup` 之后还会自己补一发 `click`（`setPointerCapture` 让目标仍是它），所以拖动结束照样跳页 —— 点按判定只拦住了 `onActivate`，没拦住浏览器自带的链接点击。
- 文件：`src/scripts/identity-physics.ts`、`src/scripts/identity-player.ts`、`src/views/IntroPage.astro`。
- 函数：`createIdentityPhysics()` 内部新增 `dropped` 集合与 `swallowClickUntil`；`reveal(index, source)` 改成**已有身体时"重新抛回场上"**（`frozen.delete` + `Sleeping.set(false)` + `Body.setAngle(0)` + `Body.setPosition` + 速度），不再直接 return；`reset()` 连 `dropped` 一起清空；`initIdentity()` 里 `needsAnimation` 恒为 `true`（落点记忆只做"先摆出来"的兜底）。
- 钩子/数据：无新增；落点 cookie 仍在写，`restore()` 的职责收窄成"先摆出来"（见 §5.8）。
- 验证：无头 Chrome（CDP，1280×900）跑完整流程实测 —— 修前：`返回后 1.5s 内 transforms 完全不变（静止）`、`拖动自我介绍 → URL 变成 /about/intro/`；修后：`返回后方块仍在动（重新落位）`、`拖动自我介绍位移约 170px 且 URL 仍是 /about/`、`拖完再点一下 → /about/intro/（点击照常）`、`普通方块拖动正常`、`硬刷新后 10 个方块立刻可见（兜底生效、不是空地）`、控制台 0 报错。`npm test` 69/69、`npm run check` 0 错误 0 警告、`npm run build` 17 页。

### 2026-09-19 · About 第十个标签「自我介绍」+ 整页长文（中英）+ 这一页续播夜曲

- 需求：1) About 的身份标签从九个加到十个 —— 第十个要在"弱起 + 前四小节"里放出来，尺寸比别的标签大一点（本人先要 0.5 倍，看到实物后改成 0.2 倍），文案"自我介绍（听了这么久，点一点我吧，求求了(｡>﹏<｡)）"，点开进一个全新的页面；2) 新页面是一整页自我介绍长文（本人原文 + 英文翻译），本人标了分段的地方标题要加大加粗，并插入 `src/images/` 里的图；3) 标签文案太长 → 排成两行；标题上方的"⸻ 短线"要删掉；4) 这一页要接着放 About 的夜曲（不是按主题播背景音乐），左上角加一个返回按钮。
- 文件：`src/lib/identity.ts`（第十个标签、`tagLines()`、`IDENTITY_INTRO_VOLUME`）、`src/lib/pages.ts`（`introRoutes`）、`src/components/IdentityStage.astro`（渲染成 `<a>` + 两行文案 + 1.2× 样式 + 专属 glyph/颜色）、`src/scripts/identity-physics.ts`（点按判定、大标签不自转、队形间距）、`src/scripts/identity-player.ts`（`navigate()`）、`src/scripts/nocturne.ts`（**新增**：这一页的背景演奏）、`src/scripts/app.ts`（boot / before-swap / `setAboutActive`）、`src/styles/tokens.css`（`--identity-intro` 两套主题）、**新增** `src/views/IntroPage.astro`、`src/pages/about/intro/index.astro`、`src/pages/en/about/intro/index.astro`、`src/content/pages/intro.zh.md`、`src/content/pages/intro.en.md`、`tests/identity.test.mjs`、`tests/identity-midi.test.mjs`。
- 函数：`tagLines(tag, lang)`（把"自我介绍（…）"拆成标题行 + 括号行）、`createIdentityPhysics(root, tags, onSettled, onActivate)`（新增第四个参数：点按回调）、`initNocturne()` / `disposeNocturne()`、`getPage('intro', lang)`、`render(entry)`、`introRoutes`、`IDENTITY_INTRO_VOLUME`。
- 钩子/数据：新增 `[data-identity-link]`（第十个标签的 href：放大 + 可点开，参与点按判定）、`[data-nocturne]`（自我介绍页根节点）、`[data-nocturne-ready]` / `[data-nocturne-state]` / `[data-nocturne-at]`；没有新 storage key（夜曲与 About 共用时间线 `space.position.v1.identity:nocturne`）；旧落点 cookie 长度对不上会自动重播一次，属预期。
- 验证：`npm test` 69/69（新增"十个标签""十个揭示时刻都落在弱起+前四小节内""文案拆两行""夜曲音量"四条断言）；`npm run check` 0 错误 0 警告；`npm run build` 17 页、头图出 4 档 webp（2.6MB → 33/70/142/273kB）。浏览器实测（本地 preview，639px 视口）：`/about/` 10 个标签、第十个 18px/353×76（其余 15px/106×46 = 1.2×）、两行文案、"点一下"跳 `/about/intro/`、拖动 90px 不误跳（URL 仍是 `/about/`）；自我介绍页 h1 34.5px、15 个 `##` 标题 28.1px/700 且 `::before` 为 none（短线已删）、头图 588×331 webp、左上角"← 返回关于"指向 `/about/`；夜曲 `data-nocturne-state=playing`，`data-nocturne-at` 从 About 页的进度接着走（点击时约 2:1x，进入新页后继续累加，没有从 0 重来）。

> ⚠️ 更正：上面这条里"拖动 90px 不误跳"是**当时的错误结论** —— 浏览器自带的链接点击仍会在拖动后跳页，已在 §10 最上面那条修复（中文返回按钮也改成只写`返回`）。

### 2026-09-19 · 修复"液态玻璃"在线上失效（构建把 backdrop-filter 合并成只剩 -webkit-）

- 需求：线上站点所有玻璃材质都成了"纯透明"，本地 dev 正常。
- 根因：源码把属性写成成对的 `backdrop-filter: X;` + `-webkit-backdrop-filter: X;`；构建管线里的 **lightningcss** 会把这一对合并，并保留 `-webkit-` 那份、丢掉标准属性（`node -e` 复现：输入两份、输出只剩前缀版）。Chromium 不支持 `-webkit-backdrop-filter`（实测 `CSS.supports('-webkit-backdrop-filter','blur(4px)') === false`），于是产物里的玻璃模糊全部失效：构建产物里标准属性 0 处、`-webkit-` 13 处。
- 文件：`src/styles/global.css`（删 5 行）、`src/styles/home-glass.css`（删 1 行）、`src/components/Header.astro`、`src/components/MiniLab.astro`、`src/components/MusicSystem.astro`（删 2 行）、`src/components/ThemeSwitcher.astro`、`src/components/ContactTiles.astro`（删 2 行并保留标准属性）、`src/components/ContactPanelBaroque.astro` —— 共删除 14 行手写的前缀副本。
- 函数：无 —— 纯样式修复。
- 钩子/数据：无。
- 要点：**不要再手写 `-webkit-backdrop-filter`**：它会被构建合并成"只有前缀"的形态，在 Chromium 里等于没有这个效果。要兼容老 Safari 应该上 autoprefixer + browserslist，前缀交给构建工具生成。验收标准：`dist/_astro/*.css` 里标准 `backdrop-filter` 必须存在（本次修复后 标准=13、`-webkit-`=0）。
- 验证：浏览器实测同一元素 —— 修复前线上 `.site-header` 计算值 `backdrop-filter: none`、本地 dev 为 `blur(30px) saturate(1.5)`；修复后重建产物里标准属性回归（13 处、前缀 0 处），`npm test` 65 通过、`astro check` 0 error；推送后由 Render 重新部署并复查线上计算值。

### 2026-09-19 · 修掉正文焦点框造成的"边缘蓝线"

- 需求：进入网站后，页面上下边缘各多出一条横贯屏幕的蓝线（用户反馈）。
- 根因：入场动画结束后 `entry-gate.ts` 把键盘焦点交给 `main`（无障碍需要），全局 `:focus-visible` 规则给 `main` 画了 2px 的 accent 焦点框；`main` 占满整页宽，焦点框的上下两条边就成了横贯屏幕的蓝线。1.5× 屏幕缩放下 2px 渲染为 3 物理像素，与用户截图逐像素吻合（#4A6EE0、3px）。
- 文件：`src/styles/global.css`（新增 `main:focus, main:focus-visible { outline: none }`）、`DEVELOPMENT.md`（本条）。
- 函数：无 —— 纯样式修复。`entry-gate.ts` 里的 `main.focus()` 保持不变（焦点转移是无障碍需要），只是不再画可见的焦点框。
- 钩子/数据：无。
- 验证：修复前线上实测 —— `main` 命中 `:focus-visible`，计算样式 `outline: solid 2px rgb(74, 110, 224)`、offset 2px，截图在导航栏下方能清楚看到蓝线；修复后 `npm test` / `npm run check` / `npm run build` 全绿，推送后由 Render 重新部署并复查。

### 2026-09-19 · 部署到 Render（Static Site）

- 需求：把仓库部署到 Render，线上可访问。
- 站点：https://the-rest-note.onrender.com （Static Site，Service ID `srv-damndi8u01pc7389r0q0`）
- 配置：仓库 `MinerTob/the-rest-note`、分支 `main`、Build Command `npm ci && npm run build`、Publish Directory `dist`、**没有环境变量**。
- 文件：`DEVELOPMENT.md`（本条）。`.node-version` 与 `package.json` 的 `engines` 沿用上一条，未改动。
- 函数：无 —— 不动任何运行时代码。
- 钩子/数据：无。
- 要点：
  - **Render 会正常拉取 Git LFS 对象。** 实测上线后的 `public/music/*.mp3` 与 `public/audio/piano/*.mp3` 是真实音频（字节数与本地完全一致），不是 128 字节的 LFS 指针。之前担心的「静态托管拿不到 LFS」在这条链路上不存在，所以构建命令里**不需要**额外的 `git lfs pull`。
  - Node 版本由仓库的 `.node-version`（`22.22.0`）决定，构建日志打印 `Using Node.js version 22.22.0 via /opt/render/project/src/.node-version`。**不要在 Render 后台加 `NODE_VERSION` 环境变量** —— 它的优先级高于 `.node-version`，会把仓库里的版本声明顶掉（已踩过一次，加完又删掉了）。
  - 推送 `main` 会触发自动部署（Auto-Deploy 默认开启）。
  - `astro.config.mjs` 的 `site` 与 `SITE.url` 仍是 `https://example.com`，换正式域名之前 canonical / RSS / sitemap 都指向示例域名。
- 验证：三次部署全部 `Deploy succeeded | Live`（首次 18.8s、去掉环境变量后 15.2s、换成 `npm ci` 后 20.3s）；线上 `/`、`/blog/`、`/en/`、`/lab/`、`/about/`、`/rss.xml`、`/sitemap-index.xml` 均 200；4 个音频文件线上字节数与本地逐字节一致；真实浏览器打开首页，LCD 时钟（UTC+08:00 新加坡）、MiniLab 25 键、88 键标签、背景音乐（DAO XIANG 播放中 `0:01 / 3:38`）全部正常。
### 2026-09-19 · 修复 Render 部署失败（Node 版本）

- 需求：Render 上绑这个仓库后构建失败。
- 现象：`astro build` 直接退出，日志 `Node.js v20.15.1 is not supported by Astro! Please upgrade Node.js to a supported version: ">=22.12.0"`。
- 原因：Render 的默认 Node 版本取决于**服务创建时间**（2024-07 ~ 2024-10 创建的服务默认 20.15.1）；仓库当初没有任何 Node 版本声明，所以拿不到新版本。
- 文件：`.node-version`（新增，内容 `22.22.0`）、`package.json`（新增 `engines.node = ">=22.12.0 <25.0.0"` 与 `engines.npm`）、`README.md`（部署章节补 Render 设置与 Node 版本说明）。
- 函数：无 —— 不动任何运行时代码。
- 钩子/数据：无。
- 要点：Render 判定 Node 版本的优先级是 `NODE_VERSION` 环境变量 > `.node-version` > `.nvmrc` > `package.json` 的 `engines`。`.node-version` 取的是 Render 默认版本历史表里出现过的版本号，避免指定到平台上不存在的版本。
- 验证：本地 `node -v` = 22.12.0 ≥ 要求；`package.json` JSON 解析通过；推送后由 Render 重新部署确认。
### 2026-09-19 · 仓库重建 + 上传 GitHub（Git LFS）

- 需求：把项目从旧的 ximu 仓库里拆出来独立成新仓库；补全 README；清掉旧 git 历史；音频等大文件交给 Git LFS。
- 文件：`README.md`（重写补全：目录 / 功能一览 / 技术栈 / 部署 / 仓库与 Git LFS / 许可与署名，并修正 SITE.name 等过时描述）、`.gitignore`（新增 `.codegraph/`、`.git-backup-ximu/`、`*.tsbuildinfo`、系统杂物）、`.gitattributes`（新增：`* text=auto eol=lf` + LFS 规则）、`DEVELOPMENT.md`。
- 函数：无 —— 不动任何运行时代码。
- 钩子/数据：无。
- 仓库状态：旧历史整份备份到 `.git-backup-ximu/`（已 gitignore，可删）；`.git` 清空后 `git init -b main`；`origin` = https://github.com/MinerTob/the-rest-note 。
- LFS：`git lfs ls-files` 32 个对象（30 个钢琴采样 + `dao-xiang.mp3` + `secret/canon.mp3`，约 12 MB）。SVG / MIDI 刻意**不**走 LFS。
- 验证：`git log` 只有一条初始提交；`git status` 干净；推送后远端 `main` 与全部 LFS 对象上传完成。
### 2026-09-19 · 语言切换改为"文字滑出 / 滑入"

- 需求：切换语言时**只有文字动** —— 旧文字向左滑出，新语言文字从右滑入；删掉之前"整页各层一起滑动"的动画。
- 文件：`src/scripts/lang.ts`（重写）、`src/styles/global.css`（删除 `language-slide-*`，新增 `lang-text-*`）、`src/scripts/app.ts`（`before-swap` 里标记新文档）、`README.md`。
- 函数：`collectTextElements()`、`playOut()`、`playIn()`、`markIncomingLanguageText()`、`playIncomingTransition()`、`switchChromeInPlace()`。
- 钩子/数据：`.lang-slide-out` / `.lang-slide-in` 类名、sessionStorage `space.lang-transition`、每个元素上的 `--lang-opacity`。
- 验证：无头 Chrome 实测 —— 190 个文字元素滑出、113 个滑入；`body` / `main` / `header` 的 `animation-name` 均为 `none`；动画结束后无类名残留、无 `--lang-opacity` 残留；`npm test` 65 通过；`astro check` 0 error。

### 2026-09-18 · 项目基线（文档建立前的存量功能）

- 说明：这份文档建立之前就存在的功能，已经按模块登记在 §3 / §5，这里只留一条基线快照。
- 包含：双语站点与语言切换、modern / baroque 双主题、背景音乐系统与隐藏曲目彩蛋（Shift+P 提示模式）、MiniLab 25 键 + 真实 MIDI + 合成器 + 采样钢琴、About 身份实验场（matter-js + MIDI 驱动）、入场页、联系复制、LCD 时钟与系统提示、Journey 首页、博客 / 文章 / 标签 / Lab / About / 404、RSS 与 sitemap。

---

## 11. 常见坑与 FAQ

1. **换页后交互失效**：脚本只执行一次。要么给绑定加 `dataset.ready === '1'` 守卫，要么用 `document` 级事件委托，要么在 `boot()` 里重新绑定。
2. **构建期报 `document is not defined`**：把浏览器逻辑写进了 `.astro` 的 frontmatter 或 `lib/`。浏览器行为一律放 `src/scripts/`。
3. **换主题后有个元素颜色不对**：组件里写死了颜色。改成 `tokens.css` 的语义变量，并在两套主题下都能看。
4. **切语言后某处文案没变**：那个元素没带 `data-i18n` / `data-zh` / `data-en`（或没用 `<T>`）。
5. **没有声音**：音频必须在用户手势里解锁 —— 入场页的 `music.play()` 必须留在 click 处理器里，不能挪进 `setTimeout` / `await` 之后。
6. **定时器越积越多**：新的 `setInterval` / `setTimeout`（长生命周期）要 `push` 进 `global.timers`，`clearTimers()` 换页时统一清理。
7. **某个动画"不生效"**：组件 scoped 样式（`[data-astro-cid-...]`）优先级高于全局单类选择器；例如时钟的 `.is-tick` 会盖过语言切换动画 —— 已知且可接受。
8. **`dist/` 是构建产物**：不要手改；改完源码跑 `npm run build`。
9. **双语键漏了一半**：`ui.ts` 里 zh / en 两个字典都要加，否则取不到会回退成 key 本身。
10. **手写的 `-webkit-` 前缀会被构建吞掉**：`backdrop-filter` 与 `-webkit-backdrop-filter` 成对书写时，lightningcss 合并后只留前缀那份，Chromium 不认 → 玻璃效果全没（见 §10 的修复记录）。只写标准属性，前缀交给构建工具。
11. **第十个标签（自我介绍）**：它比别的标签大 0.2 倍 —— 放大只能改 font-size / padding（写成 `calc(基准 * 1.2)`），写 `transform: scale()` 会被物理引擎每帧覆盖；"点开"的判定在 `identity-physics.ts`（位移 < 8px 且 0.7s 内抬手），拖动抛掷时这次抬手不算点按，`swallowClickUntil` 还会在捕获阶段吃掉浏览器自带的 `click`（300ms 窗口），所以**拖完不会跳页，点一下照常进自我介绍页**。要改尺寸就改 `IdentityStage.astro` 里 `[data-identity-link]` 那组规则；要改文案就改 `src/lib/identity.ts` 的最后一个条目。
12. **回到 About 后方块一动不动**：别去找引擎 —— 十有八九是落点 cookie 命中、`restore()` 把方块"存档摆好"了。除了"切语言"那一趟（`takeLanguageSwap()` 为真，刻意保留落点），`needsAnimation` 恒为 `true`，音乐一响就会把方块重新抛回场上再落一次（见 §5.8）。
14. **切语言之后标签整排重弹 / 页面位移**：先看 §5.8 那三条坑 —— 用模块变量判"这一趟是切语言"、用 `restored < tags.length` 判"要不要重落"、离开页面前没写"此刻"的落点，都会重现这个 bug。
13. **又看到蓝框 / 蓝线**：焦点圈只在"最近一次操作是键盘"时才画（`html[data-input]`，见 §5.13 与 §10）。脚本 `focus()` 之后浏览器会把元素当成键盘焦点，所以任何裸写的 `:focus-visible`（或脚本聚焦点的鼠标态）都会在鼠标玩家那里画出蓝框。

---

*文档最后更新：2026-09-19。新增功能记得更新 §10。*
