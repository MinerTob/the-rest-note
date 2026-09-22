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
| 生产 | Render **Web Service**：`npm install && npm run build` + `npm run start:server`（静态 `dist/` + 极薄 Node 入口网关，见 §5.18） |
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

server/           ★ 生产用极薄 Node 网关（HTTP 入口 / Entry Gate cookie / dist 分发，见 §5.18）
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
- **生产环境的 HTTP 入口在浏览器之前**：`server/` 那个 Node 网关（§5.18）先决定"这个请求该 302 回首页还是直接发 HTML"，浏览器这边的一切都跑在它之后。仅静态托管（不跑网关）时没有服务端那半，NEW VISIT 的子路由只能靠客户端跳走。

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
| LCD 时钟 | `src/components/LcdClock.astro`、`src/scripts/clock.ts` | `initClock()` | `[data-clock]`、`[data-clock-time]`、`[data-clock-date]`、`[data-clock-zone]` |
| 背景音乐播放器 | `src/components/MusicSystem.astro`、`src/scripts/music-manager.ts`、`music-ui.ts`、`src/lib/music.ts` | `MusicManager`、`initMusicUI()` | `[data-music]`、`[data-music-toggle/-progress/-volume/-state/-title/-subtitle/-time]` |
| 播放进度记忆 | `src/lib/live-timeline.ts` | `savedPosition()` / `savePosition()` / `restartPosition()` | sessionStorage `space.position.v1.<id>` |
| MiniLab 25 键 | `src/components/MiniLab.astro`、`src/scripts/minilab.ts`、`notes.ts` | `initMiniLab()`、`MiniLabController` | `[data-minilab*]`、`[data-midi]`、`data-word-*` |
| 钢琴采样引擎 | `src/scripts/piano.ts`、`src/lib/piano.ts` | `PianoEngine`、`nearestSample()`、`playbackRateFor()`、`samplesForRange()` | 事件 `piano:state` / `piano:context` / `piano:progress` |
| 合成器（无采样兜底） | `src/scripts/synth.ts` | `KeysSynth.unlock()` / `noteOn()` / `noteOff()` / `allNotesOff()` | — |
| 真实 MIDI 键盘 | `src/scripts/midi.ts` | `MidiBridge`、`getMidiBridge()` | 事件 `midi:noteon` / `midi:noteoff` / `midi:change` |
| 彩蛋（隐藏曲目） | `src/lib/easter-eggs.ts`、`src/lib/sequences.ts`、`src/scripts/easter-eggs.ts` | `EASTER_EGGS`、`HOLD_TO_ARM` / `isArmChord()`（入口和弦）、`createSequenceDetector()`、`createSequenceSession()`、`EasterEggManager`（`toggleHint()` / `holdNote()` / `releaseNote()`） | `[data-note]`（琴键）、事件 `minilab:note` / `minilab:release` / `egg:hint` / `egg:accept` / `egg:miss` |
| About 身份实验场 | `src/components/IdentityStage.astro`、`src/scripts/identity-player.ts`、`identity-physics.ts`、`src/lib/identity.ts`、`identity-midi.ts` | `createIdentityPhysics()`（`reveal()` / `restore()` / `markPlaced()` / `snapshot()`，内部 `makeBody()` 管尺寸自愈）、`initIdentity()`、`disposeIdentity()`、`setIdentityActive()`、`identityRevealPlan()` | `[data-identity*]`、`[data-identity-tag][data-revealed]`、cookie `rest-note-identity-v3-<这一趟访问的 id>` |
| 手机摇晃彩蛋（标签跟着晃） | `src/scripts/identity-motion.ts`、`src/lib/shake.ts`、`src/scripts/identity-physics.ts`（`shove()`）、`src/scripts/entry-gate.ts`（入场时申请权限） | `requestMotionAccess()`、`attachIdentityMotion()`、`createShakeDetector()` | `[data-identity]`、`[data-entry-button]`（申请运动权限的那次手势）；传感器事件 `devicemotion`；`getGlobal().motionAccess` |
| 夜曲跨页不断音（关于 ⇄ 关于我） | `src/scripts/nocturne-transport.ts`（**全站唯一那台播放器**）、`src/scripts/identity-audio.ts`（那架共用的琴）、`identity-player.ts` / `nocturne.ts`（只 attach UI）、`app.ts`（进出族时停/收） | `nocturneTransport()`、`stopNocturneTransport()`、`NocturneTransport`（`subscribe()` / `start()` / `pause()` / `seek()` / `restart()` / `attachVolume()`）、`identityPiano()`、`releaseIdentityPiano()`、`rampIdentityVolume()` | `getGlobal().identityPiano` / `.nocturne`；无 DOM 钩子 |
| 回到关于区的落点（精确 scrollY） | `src/scripts/scene-scroll.ts`、`src/scripts/app.ts` | `rememberFamilyScroll()`、`takeFamilyScroll()`、`peekFamilyScroll()`、`restoreScroll()`、`isLanguageSwap()` | sessionStorage `space.scene-scroll` |
| 自我介绍页（第十个标签的去处） | `src/views/IntroPage.astro`、`src/pages/about/intro/index.astro`、`src/content/pages/intro.zh.md` / `intro.en.md`、`src/lib/pages.ts` | `getPage('intro', lang)`、`render(entry)`、`introRoutes` | `[data-identity-link]`（写在 About 页的标签上） |
| 联系方式 / 复制 | `src/components/ContactTiles.astro`、`ContactPanel*.astro`、`src/scripts/contact.ts`、`src/lib/contact.ts` | `initContact()`、`CONTACT`、`isInteractive()` | `[data-contact]`、`[data-contact-row]`、`[data-contact-copy]` |
| 系统提示 LCD | `src/components/SystemMessage.astro`、`src/scripts/system-message.ts` | `initSystemMessages()` | `[data-system-message]`、window 事件 `space:message` |
| 入场页 | `src/components/EntryGate.astro`、`src/scripts/entry-gate.ts` | `initEntryGate()` | `[data-entry-gate]`、`[data-entry-button]`、`[data-entry-copy]` |
| **访问会话 / 入场边界** | `src/scripts/visit-session.ts`、`src/lib/visit.ts`、`src/scripts/entry-gate.ts`、`identity-player.ts` | `visitSession()`（`token` / `isNew` / `hasEntered()` / `markEntered()`）、`visitBoundary()`、`navigationKind()`、`readEntryToken()` / `stampEntryToken()` | sessionStorage `rest-note.visit`、`rest-note.entry-passed`、`history.state.restNoteVisit`、`html[data-visit]` |
| 首页 Journey 长页 | `src/views/JourneyPage.astro`、`src/scripts/app.ts` 里的 `initJourney()`、`src/lib/scene.ts` | `initJourney()`、`updateActiveSection()`（导航蓝杠：视口观察线）、`sceneCoverage()`、`sceneDecision()` | `[data-journey]`、`[data-journey-section]`、`[data-journey-section="about"][data-scene]` |
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

**文件**：`src/components/MusicSystem.astro`、`src/scripts/music-manager.ts`、`src/scripts/music-ui.ts`、`src/scripts/audio-unlock.ts`、`src/lib/music.ts`、`src/lib/live-timeline.ts`

```ts
class MusicManager extends EventTarget {
  get track(): Track;
  init(): void;                         // boot：这一趟该不该自己响，只在这里判一次
  play(): Promise<void>; pause(): void; toggle(): void;
  resume(): void;                       // ThemeManager"同一首主题曲"路径
  crossfadeTo(id, options?): Promise<boolean>;   // 换曲（force = 明确的"我要听这一首"）
  retryIfIdle(): void;                  // 手势 / canplay / pageshow / visibility 的自动恢复入口
  setAutoStart(v) / setVolume(v) / setMuted(v) / toggleMute() / setDucked(v): void;
  getState(): 'idle'|'ready'|'active'|'paused'|'error';
  getVolume(): number; isMuted(): boolean; isPlaying(): boolean;
  getProgress(): { currentTime, duration, ratio };
  seekToRatio(ratio): void;
  setAboutActive(active: boolean): void;      // 只抢音频焦点（duck + 暂停），不改用户意图
}
function initMusicUI(music: MusicManager): void;
```

**单一事实来源：两条不变量（§10 的 2026-09-22 重构记录里有动机与实测）**

- **A. 用户意图只有一份：`shouldPlay`。** 由且仅由 `play()`（→ true）、`pause()`（→ false）、换主题的 force 路径（`crossfadeTo(id, { force: true })` 与同一首时的 `resume()`）改写；持久化仍用 `space.paused`（`shouldPlay = !space.paused`，key 不迁移）。**浏览器事件（`pause` / `playing` / `canplay` / `error`）、autoplay 被拒、About 让位、`visibilitychange` / `pageshow`、`retryIfIdle()` 一律不许改它** —— 它们只影响"此刻能不能响"。
- **B. 实际在不在播只看当前那一个 `HTMLAudioElement`。** `isPlaying()` 直接读 `el.paused` / `ended` / `readyState`；`getState()` 现场推导（`error` → `paused`（用户不想播）→ `paused`（About 让位）→ `active`（元素真在响）→ `ready`（有元素、想播但没响）→ `idle`（还没建元素））。所以 **`active` 必然意味着元素真的在响**，不存在"UI 说在播、元素其实停着"；浏览器拦下 autoplay 时自然得到 `ready`，而不会被伪装成 `paused` 或 `active`。

**其余不变量**

- **C. `currentTime` 只有两个主动写入点**：① 接管一个 element 时恢复一次（`restorePositionOnce()`，每个 element 一生只做一次，元数据没到就挂**一个** `loadedmetadata` 等它）；② 用户拖进度条（`seekToRatio()`）。`play()` / `resume()` / `retryIfIdle()` / `canplay` / `pageshow` / `visibilitychange` **都不许**在起播前"同步一遍保存位置" —— 同一个元素停在哪儿就是哪儿，这就是"同一首暂停后继续不会跳回旧位置"的根据。
- **D. About / MIDI 只抢音频焦点**：`setAboutActive(true)` 把音量归零并暂停所有主题 MP3、作废在飞的启动与切换，但**不动 `shouldPlay`**；`setAboutActive(false)` 只看 `shouldPlay` 决定要不要恢复（不再有"进入前想不想播"的第二份意图）。About 期间换主题仍然会把当前曲目切到新主题曲（恢复它自己的保存位置），只是保持暂停，离开 About 后按 `shouldPlay` 接着放。
- **E. 自动恢复只有一条路、同一时刻最多一条在飞**：`init()` / `retryIfIdle()`（`canplay` / `pageshow` / `visibilitychange` / `audio-unlock` 都汇到这里）最终都进 `requestAutoStart()`，条件统一为 `shouldPlay && !inAbout && autoStart && !isPlaying()`；已有启动在飞就直接返回。`play()` 与它共用同一个"在飞"登记位 —— 入场页那次点击里 `music.play()` 紧跟着的 `audioUnlock() → retryIfIdle()` 因此不会在同一个元素上并发第二次 `el.play()`。
- **F. 过期异步操作无害**：`switchToken` 在每次启动 / 切换 / 暂停 / 进出 About 时 +1；`await el.play()` 回来先对号，对不上就只许安静退场（旧元素已经不是当前曲目时顺手 `volume = 0; pause()`），绝不改 `shouldPlay`、不改 `this.el`、不停掉新的那次播放。
- **G. 每首曲子各自一个 element、各自一条时间线**：`crossfadeTo()` 切走前把旧曲进度落到 `space.position.v1.track:<id>`（格式不变），新曲只在自己**第一次**被接管时 `restorePositionOnce()`；本次文档用过的元素里就是它自己的真实进度，反复切回来不会被 storage 覆盖。`force` 时**不再先 `await waitForCanPlay()`**（那会拖断用户手势链）：直接 `incoming.play()`（浏览器自己会等媒体 ready），旧曲在它真正起播前继续响，成功后再做原来的交叉淡入。autoplay 被拒时保留 `shouldPlay`，等下一次可信手势 / `canplay`。
- **H. 显式播放按钮继续绕开全局 capture 解锁**：`audio-unlock.ts` 的 `EXPLICIT_AUDIO_CONTROL = '[data-music-toggle], [data-identity-play]'` —— 手势落在它们上面时 document capture 的 `unlockAll()` 不抢，交给按钮自己的 `click`（`music.toggle()` / `transport.start()`），第一击就生效。
- **SAME VISIT 刷新的自动恢复怎么描述**：`initAudioUnlock({ gated:false })` 里 `music.init()` **只发一枪**（随后只补非 MP3 的琴 / 夜曲，不再 `retryIfIdle()`）。浏览器允许 → 立即接着放；浏览器拒绝 → 保持 `shouldPlay = true` + `ready`，等第一次真实 `pointerdown` / `keydown`（`unlockAll()`）或 `canplay` / `pageshow` / `visibilitychange` 再试。**这不是"一定允许无手势 autoplay"**，而是"主动尝试 + 保留意图 + 可重试"。
- 事件：`MusicManager` 派发普通 `'change'`（原生媒体事件只触发它，不写状态）；UI（`music-ui.ts`）每 260ms 重读 `getState()` / `getProgress()` 刷新面板，支持同页多个面板（`[data-music]` 循环绑定）。
- **第一次起播不从 0 淡入**（`applyVolumeForStart()`）：元素刚建出来时 volume 是 0，老写法要淡入 `AUDIO.fadeInMs`（2.4 秒），曲子开头那一下会被压到几乎听不见的音量里（timeline 在走、声音没有 —— 本人报的"第一拍没播出来 / 像还没加载好 timeline 就先走了"）。现在**本次文档的第一次**直接摆到目标音量，之后保持原来的淡入。暂停保留 450ms 淡出，但任何淡出都能被 `play()` / `pause()` / 切曲 / About 可靠取消（连同它"淡出结束再 `pause()`"的 `done` 回调）。
- 音量渐变用 `requestAnimationFrame`（`ramp()`），进度两头都 `clamp01`；`prefers-reduced-motion` 时直接跳到目标音量（不渐变）。
- 曲目定义在 `src/lib/music.ts`：`TRACKS`、`DEFAULT_TRACK_ID`、`AUDIO`（音量常量）、`getTrack()`；纯函数 `clamp01()` / `easeOutQuad()` / `volumeAt()`（有单测 `tests/audio.test.mjs`）。
- 进度记忆在 `src/lib/live-timeline.ts`：`savedPosition(id, duration)` / `savePosition(id, position)` / `restartPosition(id)`，存 sessionStorage `space.position.v1.<id>`，只记"真正播放过"的位置。
- 切主题会触发 `crossfadeTo()`（主题 ↔ 曲目绑定见 `src/lib/themes.ts` 的 `THEME_TRACK`）；`warmOtherTrack()` 在第一次播放稳定 5 秒后悄悄把另一套主题曲缓冲好（只建缓存元素 + `load()`，不改当前曲目 / 意图 / 进度，保持 paused + volume 0），省流量模式下跳过。
- **"关于"这一族页面会让位**：`app.ts` 的 boot 里，只要页面上有 `[data-identity]`（About）或 `[data-nocturne]`（自我介绍页），就调用 `music.setAboutActive(true)` —— 主题音乐被暂停、音量归零（意图保留）；这两页放的是同一首夜曲的钢琴演奏（§5.8 / §5.14）。回首页（Journey）时仍由 `initJourney()` 的观察器控制。
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
- **落点 cookie 的名字跟着"这一趟访问的 id"走**（`visitSession().token`，判定规矩见 §5.15）：新的一趟访问 = 新 cookie = 标签会被音乐重新抛一遍；同一趟（刷新 / 前进后退 / 站内换页）沿用同一个名字，落点才不会丢。`identity-player.ts` 只**读**这个 id —— 它不碰夜曲时间线，也不碰音频运行时（三套状态各管各的，见 §5.15）。**不要再自己看 `performance.navigation.type`**：那条规矩漏掉了"地址栏里重新输入同一个网址"（见 §10 的日志）。
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
- 首页 Journey 模式里，`initJourney()` 用 IntersectionObserver 在滚到 About 区时调用 `initIdentity()` / `setIdentityActive(true)`；"滚到位没有"用的是**带迟滞的覆盖度判据**（见 §5.16），不是单个阈值 —— 单个阈值在手机上会被地址栏收起/展开抖成 pause/start 反复横跳（本人报的"前几秒明显断续、卡顿"）。
- 音乐靠现有 `PianoEngine.scheduleNote()` 播 MIDI，不另做一套音频链路。
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

**文件**：`src/components/EntryGate.astro`、`src/scripts/entry-gate.ts`、`src/scripts/visit-session.ts`、`src/lib/visit.ts`、`src/scripts/app.ts`

```ts
initEntryGate(music: MusicManager): boolean;   // true = 正在拦着（页面被锁）
visitSession(): VisitSession;                  // 见 §5.15：这一趟的 id / 是不是新的一趟 / 进没进去过
```

- **拦不拦人只问一句：这一趟点过"进入"没有**（`visitSession().hasEntered()`）。"这是不是新的一趟访问"由 `visit-session.ts` 判定，判定为新的一趟时会把 `rest-note.entry-passed` 清掉 —— 所以"刷新之后又冒出入场页"不会发生，而"地址栏重新输入网址"照样会拦（规矩与实测见 §5.15）。
- **不要拿"这次文档加载算不算新访问"当拦人的判据**：整份文档里那个值是不变的，而站内换页（ClientRouter 不换文档）时 HTML 会整块换新、入场页元素跟着长出来 —— 那样写会在每次站内换页后又冒出入场页。
- 进入方式：点击 `[data-entry-button]`。这个 click 处理器里**必须直接调用** `music.play()`（浏览器自动播放策略要求音频解锁发生在可信手势里，见代码注释）。
- **点"进入"之后一定落在首页最顶上（`#home`）**：遮罩收起时把地址里遗留的锚点（浏览器恢复标签页时常见的 `#about` / `#blog`）去掉，并 `scrollTo(0, 0)`；因为 `html` 有 `scroll-behavior: smooth`，必须用 `behavior: 'instant'`，否则会当着他的面滑一大段。**要补三次**（立即 / 下一帧 / 260ms 后）：Safari 常在遮罩收起之后才把上次的滚动位置恢复回来，只滚一次会被它盖掉；后两次都跳过"有 `#锚点`"的情况 —— 那是用户自己点的站内跳转，不能抢。站内导航走客户端路由，不经过这里。
- 同一个 click 处理器里还调两个"必须在用户手势里做"的动作：`requestMotionAccess()`（`identity-motion.ts`，申请"运动与方向"权限，见 §5.8）和 `primeIdentityPiano()`（`identity-audio.ts`，把"关于"那架钢琴的 AudioContext 建起来并开始预载采样，见 §5.14）。两者都只在真正需要它们的页面生效，桌面 / 不需要 / 已经做过时静默返回，不影响入场。
- 锁定期间 body 加 `.entry-locked`，除 gate 和 `.ambient` 外的直接子元素设为 `inert`。
- **文案语言跟当前文档的页面语言走，不看 `navigator.language`**（`applyPageLanguage()`）：读 `<html data-lang>`（`BaseLayout.astro` 按页面 `lang` 渲染），`'en'` → 英文，其它 → 中文；按现有 `[data-entry-copy]` + `data-zh` / `data-en` 换文字，`aria-label` 与 `gate.dataset.language` 同一个语言。系统语言是中文的人打开 `/en/`，看到的就是英文入场页 —— NEW VISIT 的入口语言已由 `BaseHead.astro` 按 URL 归一化（见 §5.15），两边必须同一个语言，谁都不许拿系统语言覆盖路由。入场页 HTML 里那段英文兜底文案在 `.is-ready` 之前不显示（`opacity: 0`），所以不存在"先闪一下英文再换中文"。
- **点"进入"时同时给服务端网关盖章**（`void fetch('/api/enter', { method: 'POST', credentials: 'same-origin' })`，见 §5.18）：让网关写 `rest_note_entered=1`，之后站内进子页才不会被 302 回首页。**只发不等**：`markEntered()` 之后立刻发、不 await，紧接着的 `music.play()` / `audioUnlock()` 必须留在这一次点击的同步可信手势里 —— 一旦 `await`，iOS 就丢了 trusted user activation，音频解锁会失败（硬约束）。fetch 失败也不影响进站：本地 `hasEntered()` 那套仍然管用。
- `app.ts` 里：`if (!initEntryGate(music)) music.init();` —— 有入场页时由入场页负责解锁音频。
- 收尾去掉遗留锚点时用 `history.replaceState(history.state, ...)`：`history.state` 上有这一趟访问的 id（`restNoteVisit`）和 Astro 的 `index` / 滚动位置，传 `null` 会把它们抹掉，于是"带着 `#锚点` 进站 → 进站 → 刷新"会被当成新访问。

### 5.12 时钟与控制台

**文件**：`src/components/LcdClock.astro`、`src/scripts/clock.ts`、`src/scripts/console-note.ts`

- `initClock()`：对所有 `[data-clock]` 面板，每秒刷新 `[data-clock-time]` / `[data-clock-date]` / `[data-clock-zone]` / 城市名；秒变化时加 `.is-tick` 做很轻的 LCD 刷新感（reduced-motion 时跳过）。
- **显示的是访客所在地，不再固定新加坡**：一次 IP 定位（`https://ipwho.is/`，`cache: 'no-store'` + `?_=时间戳` 明确绕开旧缓存）拿到 `city` 与 `timezone.id` 后，用 `Intl.DateTimeFormat` + 该 IANA 时区跑时钟（DST 交给浏览器），UTC 偏移由 `timeZoneName: 'longOffset'` 的 `GMT±HH:MM` 现算（拿不到时用"墙上时间与 UTC 之差"兜底），都不写死偏移、不维护 DST 表。
- **定位回来之前一律空白**：不默认新加坡 / `UTC+08:00` / 任何时间文本（组件里那两个初始占位是零宽空格，只保住行高；`tick()` 在时区未知时直接 return）。IP 定位失败也保持空白，不回退新加坡。
- **城市名的三条路**（`applyLocation()`）：英文页直接显示 `ipwho.is` 的原始 `city`；中文页先查 `SPECIAL_CITY_ZH`（少量易错 / 固定译名，命中即用、**不发翻译请求**，例如 `seoul → 首尔` 防止被机翻成"汉城"）；未命中才异步调现有 Cloudflare Translate Worker（`ximu-translate.yanfangwei467.workers.dev`，`?sl=en&tl=zh-CN&q=<原始 city>`，返回 JSON 数组取 `data[0]`），失败回退显示原始英文城市名。翻译不阻塞时钟：时区 / 时间 / 日期 / 偏移在 IP 成功后立刻启用，城市名最后异步补。
- 同一文档内只请求一次 IP（模块级 Promise 缓存）与最多一次翻译（`cityZh` 记在内存）；**没有 localStorage / sessionStorage**、不持久化 IP / 城市。
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
- **About ⇄ 自我介绍 ⇄ 首页关于区：全站只有一台夜曲播放器，换页对它什么都不做**（见 §5.15 的 `nocturne-transport.ts`）。演奏的 score、`cursor`、音频时钟锚点、排程定时器、位置全在那台播放器里，页面脚本只 attach / detach UI（画瀑布流、按钮、`[data-nocturne-*]` 读数）。所以"关于 → 关于我 → 关于"听起来是一口气弹下来的：**不停、不重排、不重音、不跳进度、不重新淡入**（音量只是从当前值滑到这一页的目标值）。
  - 以前那套"离开时预排 0.45 秒 + `pause(keepRinging)` + `handOverIdentityPiano()` 接手"的做法**已经删掉**（`lib/handover.ts` 的纯换算与它的单测留着，现在没有调用方）：那不是真无缝，接缝要靠预排余量盖住。
  - 只有真的离开这一族（下一张页面里既没有 `[data-identity]` 也没有 `[data-nocturne]`）时，`app.ts` 在 `astro:before-swap` 里才 `stopNocturneTransport()` + `releaseIdentityPiano()`。
  - 实测（无头 Chrome + 真实 AudioContext）：首页关于区 → 自我介绍页 → 返回，`AudioContext` 新建计数全程不变（一直是入场时那 2 个：夜曲 + MiniLab）、时间线 9.88s → 11.43s → 15.08s 一路向前、返回后 `data-state=playing`、`data-scene=active`。
  - `initNocturne()` 在 boot 里调用，`disposeNocturne()` 在 `astro:before-swap` 里调用；缺采样或缺用户手势时只把状态标成 `waiting`，等下一次点击再开始。
  - 切到后台会暂停、切回来接着弹（与 About 页一致）；主题曲的让位由 `app.ts` 的 `setAboutActive(true)` 负责（见 §5.5）。
  - **`playing` 跟着 AudioContext 走，不跟着 UI 走**：`piano:context` 监听有两个方向 —— 上下文变成 `running` 时，若 `desired && !playing` 就 `begin()`；上下文**离开** `running`（iOS 音频会话被打断 / `suspended` / `interrupted`）时若还在 `playing` 就 `suspend()`：存位置、掐音、`playing = false`、通知 UI，**`desired` 保留**。上下文回来时上面那一支再 `begin()`，从存下的 offset 接着弹。**系统打断不等于用户暂停**：只有 `pause()`（点暂停）与离开这一族（`stop()`）才清 `desired`。少了这条反方向同步，`isPlaying()` 会一直是 `true` —— UI 显示在播、位置冻在不再前进的 `currentTime` 上、`audio-unlock.ts` 的 `desired && !isPlaying()` 也不成立，连真实手势都接不回来（"幽灵演奏"，详见 §10）。
- 状态钩子：`[data-nocturne-ready]`（乐谱解析完成）、`[data-nocturne-state="waiting|playing|paused"]` —— 排查"这一页怎么没声音"先看这两个。
- 单测：这一页是排版 + 内容 + 浏览器行为，只有常量层面的单测（`tests/identity.test.mjs` 里的音量断言）；改动后在浏览器里核对分节标题、图片、返回按钮与夜曲即可（`npm run build` 会校验内容集合字段）。

### 5.15 访问会话与入场边界

**文件**：`src/scripts/visit-session.ts`（浏览器这边）、`src/lib/visit.ts`（纯逻辑，有单测 `tests/visit.test.mjs`）、`src/components/BaseHead.astro`（`<head>` 里那段同步的早期规范化，见下）

```ts
// visit-session.ts
type VisitSession = {
  token: string;            // 这一趟访问的 id（落点 cookie 之类"每趟不一样"的东西用它）
  isNew: boolean;           // 这次**文档加载**算不算新的一趟（决定要不要把"已进入"清掉）
  hasEntered(): boolean;    // 这一趟点过"进入网站"没有 —— 入场页拦不拦人只问这一句
  markEntered(): void;
};
visitSession(): VisitSession;   // 同一份文档里只判定一次（模块级缓存）

// lib/visit.ts
navigationKind(raw): 'navigate' | 'reload' | 'back_forward' | 'unknown';
readEntryToken(state) / stampEntryToken(state, token);   // history.state 上的章（保留 Astro 的 index / scrollX / scrollY）
visitBoundary({ navigation, sessionToken, entryToken }): 'new' | 'same';
```

**三套状态从此分开，谁也不许动别人的**（这条是本人明确要求的）：

| 状态 | 在哪 | 谁负责 | 换一趟访问时 |
| --- | --- | --- | --- |
| 访问状态（这一趟的 id、进没进去过） | `visit-session.ts` + sessionStorage | `entry-gate.ts` / `identity-player.ts` | 换新 id、清掉"已进入" |
| 夜曲时间线（`identity:nocturne` 播到第几秒） | `src/lib/live-timeline.ts` | `identity-player.ts` / `nocturne.ts` | **保留**（换一趟不清） |
| 音频运行时（PianoEngine / AudioContext / 采样 / 排程） | `piano.ts` / `identity-audio.ts` | 同上 | 不受影响 |

**判定规矩**（默认往"新访问"偏：多拦一次只是多按一下，漏掉一次是本人报的 bug）：

| 用户动作 | 浏览器报的 type | 我们的判定 |
| --- | --- | --- |
| 第一次打开 / 新标签页 | `navigate`（sessionStorage 里还没有 id） | 新的一趟 |
| 站内换页（ClientRouter，不换文档） | 不产生文档加载 | 同一趟（`hasEntered()` 还留着） |
| 刷新（F5 / 刷新按钮） | `reload` | 同一趟（历史条目上的章还在） |
| 前进 / 后退 / bfcache | `back_forward` | 同一趟 |
| 地址栏重新输入**同一个**网址 | Chrome 报 `navigate`；有的浏览器报 `reload` | 新的一趟（前者按类型判，后者按"章没了"判） |
| 地址栏输入另一个网址 / 外链 / 书签 | `navigate` | 新的一趟 |

**为什么不能只看 `PerformanceNavigationTiming.type`**：不同浏览器给"地址栏里重新输入同一个网址"报的 type 不一样 —— 报 `reload` 的那种会被当成刷新，上一趟的 `entry-passed` 被沿用、入场页不再出现（本人报的 bug）。所以这里加了第二个信号：**当前历史条目上有没有我们自己盖的访问 id**（`history.state.restNoteVisit`，每次 boot 都补盖一次）。刷新会把条目原样留下来（章还在 → 同一趟），而"地址栏重新输入网址"是一次新的导航、条目被顶掉（章没了 → 新的一趟）。

**两个容易踩的点**：
1. **每次 boot 都要补盖一次章**：Astro 的客户端路由换页时是 `history.pushState({ index, scrollX, scrollY })`，会把条目上原有的字段整个换掉。不补盖的话，"站内换页之后再刷新"会被当成新的一趟，凭空多一次入场页。
2. **`history.replaceState` 一律带 `history.state` 走**：入场页收尾去掉遗留 `#锚点` 时传 `null`，会把章和 Astro 的滚动位置一起抹掉（见 §5.11）。

**NEW VISIT 的入口归一化：服务端管 HTTP 入口，客户端只兜 `#fragment`**

语义（本人定的最终版）：**NEW VISIT 不许直接落在子页面**。中文一律进 `/`，英文（`/en/` 及其下）一律进 `/en/`；在首页显示 Entry Gate，用户点过"进入空间"之后就停在首页，**不再跳回原来的子页**。

这一条现在有**两个执行者，各管一半**（不许再各自实现一遍对方那半）：

| 谁 | 管什么 | 在哪 |
| --- | --- | --- |
| 服务端网关（生产） | "未进门的子路由 → 本语言首页"：`302`，`rest_note_entered === '1'` 之后不再拦 | `server/entry-router.ts` `decideEntry()`，见 §5.18 |
| 客户端（`<head>` 早期脚本） | **`#fragment`**：`/#about`、`/en/#blog` 服务端根本看不见 | `src/components/BaseHead.astro` |

客户端那段 `is:inline` 同步脚本（紧跟 viewport meta、在主题脚本之前）现在只做：

1. 判 NEW / SAME（照抄 `lib/visit.ts` 的 `visitBoundary()`）：没有 session token → NEW；`navigate` → NEW；`reload` → `history.state.restNoteVisit === session token` 才算 SAME，否则 NEW；`back_forward` → SAME；拿不到 / 认不出 type → NEW。`sessionStorage` / `history.state` / `performance` 的读取都包在 try/catch 里。
2. **SAME VISIT 立即早退**，一个字节都不改：刷新子页就留在子页、站内点击文章 / About → Intro / 返回 / 前进后退 / 语言切换都照旧。
3. NEW VISIT 时判"这一页是不是本语言的首页"，用的是和服务端**同一条规矩**（pathname 的第一个非空 segment）：
   ```js
   var parts = location.pathname.split('/').filter(Boolean);
   var isEnglish = parts[0] === 'en';
   var isLanguageHome = isEnglish ? parts.length === 1 : parts.length === 0;
   ```
   `'/'`、`'/en'`、`'/en/'` → 首页；`'/blog/...'`、`'/en/blog/...'`、`'/about/intro/...'` → 子页（这里什么都不做）。
   - 首页 + hash 是 `#home` / `#blog` / `#lab` / `#about` → `history.replaceState(history.state, '', pathname + search)`，**只抹 hash**，search / pathname / `history.state` 不动。
   - 子页 → **什么都不做**（`location.replace(target)` 那一支本轮已删：同一件事留两套实现迟早漂移）。
4. 不写 sessionStorage、不建新的 visit token、不碰 Entry Gate / 音频。

- **为什么还剩客户端这一半**：`#fragment` 不会发给服务器，所以浏览器解析到 section id 时那次原生 fragment 定位只能靠 `<head>` 里的同步脚本来挡（不等 DOMContentLoaded / `astro:page-load` / `requestAnimationFrame` / `app.ts` 的 `boot()`）。关于区 observer、夜曲、身份物理都是被那一下带起来的。
- **为什么子页那一半搬到服务端**：放在 HTTP 层可以在**任何 HTML 进浏览器之前**就 302，子页连一帧都不会渲染；客户端 `location.replace()` 总要先把子页 HTML 下载并解析一段。
- **静态资源**：`/_astro/`、图片、favicon、sitemap、`rss.xml`、`robots.txt` 不经过 `BaseHead.astro`（`rss.xml` 是 `src/pages/rss.xml.ts` 的 API 路由、sitemap 由集成生成），服务端侧也按后缀 / 前缀判定为静态，永不参与重定向（§5.18）。
- **只有这一处客户端判定**：`app.ts` 里既没有重定向逻辑也没有第二份 NEW/SAME 判定；`boot()` 里 NEW VISIT 的 `restoreScroll(0)`、SAME VISIT 的落点恢复都照旧。
- **服务端 302 之后那一趟仍是 NEW**：`location.replace()`（旧客户端方案）与 HTTP 302 报的都是 `navigate`，目标首页本来就是这个语言首页，所以不会再跳、也不会死循环 —— Entry Gate 正常在首页出现（语言由 `<html data-lang>` 决定，见 §5.11）。

### 5.16 长页场景激活（关于区什么时候算"在观看区域"）

**文件**：`src/lib/scene.ts`（纯逻辑）、`src/scripts/app.ts` 的 `initJourney()`、有单测 `tests/scene.test.mjs`

```ts
sceneCoverage({ viewportHeight, top, bottom }): number;   // 露出高度 ÷ min(区块高度, 视口高度)
sceneDecision(active, coverage, enter = 0.55, leave = 0.25): boolean;   // 迟滞
SCENE_THRESHOLDS;   // IntersectionObserver 的 threshold 网格（41 档，只是"什么时候叫我们"）
```

- 判据是**覆盖度**而不是"露出 ÷ 区块高度"：区块比视口高时铺满视口就算 1，比视口矮时整块看得见才算 1。视口高度变化对它的影响比原来那条小得多。
- 进出用**两个不同阈值**（0.55 / 0.25，中间 0.30 是迟滞带）：只有真的跨过去才切状态，抖动落在带子里就什么也不做。**没有 setTimeout / debounce** —— 不抖是因为判据本身稳，不是因为拖时间。
- 实测（无头 Chrome，393×852，关于区高 679px）：停在旧判据 0.35 的边界上，地址栏收起/展开（视口 852 ↔ 750，判据 0.35 ↔ 0.373）在修前让 `data-state` 连着翻了 **5** 次（pause → playing → pause → playing → pause，每次都 `allNotesOff()` + 重新排程，听起来就是"前几秒明显断续"）；修后同一条路径 **0** 次。真的走远（滚回博客区）仍然会停（`data-scene=idle`、`data-state=paused`）。
- 排查读数：`[data-journey-section="about"][data-scene="active|idle"]`。

### 5.17 客户端启动生命周期（boot 一次、换页一次）

**文件**：`src/scripts/app.ts`

- **一次"页面加载"只 boot 一次**：ClientRouter 在初始硬加载上也会发 `astro:page-load`（`router.js` 里 `addEventListener('load', onPageLoad)`），而 `app.ts` 还会在 DOMContentLoaded（或脚本一执行完）自己 boot 一次 —— 于是刷新时 boot 跑两遍：

  ```
  boot #1 → initJourney → 观察器 → initIdentity → 建播放器、读谱、预载采样
  boot #2 → disposeJourney → disposeIdentity → abort 掉正在飞的请求、拆掉物理引擎 → 再建一个播放器
  ```

  中间那次 dispose 会掐掉刚起来的那一套（表现就是本人说的"刷新之后夜曲进不了可播放状态"）。现在 `boot()` 由模块级 `booted` 把关：同一次加载里第二次调用直接返回；换页真的发生（`astro:after-swap`）时才把闸门打开。兜底的 DOMContentLoaded 那一支也走同一道闸门。
- **页面级清理只在两个地方**：`astro:before-swap`（换页前：`disposeJourney()` / `disposeIdentity()` / `disposeNocturne()` / MiniLab 收摊、必要时 `releaseIdentityPiano()`）和 `disposeJourney()` 内部。**`disposeJourney()` 无条件 `disposeIdentity()`**：以前写成 `if (aboutActive)`，于是"滚进关于区 → 滚回上面 → 点别的页面"这条路上播放器不会被收掉，它挂在 `document` 上的 pointerdown / wheel 监听、ResizeObserver、物理引擎会活到下一页去。
- `identity-player.ts` 里还有一个**代际守卫**：每次 `initIdentity()` 递增 `identityGeneration`，被换掉的旧 `dispose` / `setActive` 闭包发现自己不是当代就什么都不做（防止旧生命周期误杀新实例）。
- 采样下载现在**分轮进行**（`PianoEngine.preload()`，最多 4 轮、每轮隔 1.5 秒补漏掉的）：上一版开头是 `if (state === 'ready') return`，只要有一个采样成功状态就变 ready，后面那段"补下漏掉的"**永远进不来**（死代码），手机上一次请求被打断就再也补不上。另外 `ensure()` 现在会处理"上下文已被关掉"（`state === 'closed'` → 整套重来），`failed` 也不再是永久死状态。实测见 §10。

### 5.18 生产入口网关（Node Web Service，不是 Astro SSR）

**文件**：`server/index.ts`（HTTP 与静态分发）、`server/entry-router.ts`（纯判定）、`server/visit-cookie.ts`（两个 cookie）；启动脚本 `npm run start:server`

Astro 照旧只做静态构建（`npm run build` → `dist/`）。生产用 **Render Web Service** 起一个极薄 Node 进程，它只负责四件事：HTTP 入口判断、中英文 NEW VISIT 入口重定向、Entry Gate 的服务端 session cookie、从 `dist/` 分发静态文件。**前端逻辑一律不上服务器**：MIDI / AudioContext / scene / scroll / SPA 换页 / 入场页动画与音频解锁都还在浏览器里。

```ts
// entry-router.ts（纯函数，不认识 res / fs）
languageHome(pathname): '/' | '/en/';        // 第一段是 en → '/en/'，否则 '/'
isHtmlPagePath(pathname): boolean;           // '/_astro/'、'/api/'、带静态后缀 → false
isLanguageHomePath(pathname): boolean;       // '/'、'/en'、'/en/' → true
decideEntry({ method, pathname, entered }): EntryDecision;   // enter | method-not-allowed | redirect | static

// visit-cookie.ts
readEntryCookies(header): { visit, entered };   // 只读
newVisitToken(): string;                        // randomBytes(24) → base64url
visitCookie(token, secure) / enteredCookie(secure): string;
isSecureRequest(req): boolean;                  // x-forwarded-proto === 'https'（Render 在代理后面）
```

- **语言判断**与客户端 `BaseHead.astro` 同一条规矩：pathname 的第一个非空 segment 是不是 `en`。`/en`、`/en/`、`/en/blog/...`、`/en/about/intro/...` 全英文 → `/en/`；`/`、`/blog/...`、`/about/...` 全中文 → `/`。
- **未进门时的入口规则**（`rest_note_entered !== '1'`）：请求的是语言首页（`/`、`/en`、`/en/`）→ 正常返回首页 HTML，让 Entry Gate 显示；请求的是**子页面** → `302` 到本语言首页（**不带 query、不记原路由** —— 用户点过"进入空间"就停在首页）；静态资源 → 永远放行。
- **已经进门**（`rest_note_entered === '1'`）：服务端不再做子路由重定向，站内 About → Intro / Blog → 文章 / Lab / 中英切换全部照常走 Astro 静态页面（SPA 换页仍然是 ClientRouter 的事）。
- **静态资源绝不参与重定向**：`/_astro/*`、图片、CSS、JS、sitemap、RSS、favicon、robots 由后缀与前缀判定为静态，直接 `dist/` 分发。**防 path traversal**：`resolveInsideDist()` 先 `path.resolve` 规范化，再要求结果落在 `DIST_ROOT` 内（`/../..`、`%2e%2e%2f`、反斜杠变体都被拒）。
- **缓存**：HTML 一律 `Cache-Control: no-cache` + `Vary: Cookie`（入口判定依赖 cookie，浏览器缓存住子页 HTML 就等于绕过网关）；`/_astro/` 是带 hash 的产物 → `immutable`；其它静态 → `max-age=3600`。
- **`#fragment` 服务端看不见**：`/#about`、`/en/#about` 在服务器眼里只是 `/`，所以首页那四个 Journey hash 的早期清理仍然由 `BaseHead.astro` 在客户端做（见 §5.15）。
- **`POST /api/enter`**：浏览器点"进入空间"时（同一次点击、不 await）打过来，网关回 `204 No Content` 并写 `rest_note_entered=1`；不返回页面、不管音频。别的方法 → `405`。
- **启动**：`PORT` 读 `process.env.PORT`（本地默认 3000），监听 `0.0.0.0`；Node 直接跑 TypeScript（`node --experimental-strip-types`），所以没有构建步骤、没有框架依赖（不用 Express）。`SIGTERM` 时 `server.close()` 后退出。
- **`GET /health`（Render 健康检查）**：在 `handleRequest` 的**最前面**处理，早于 cookie 读取、Entry Gate 判定与静态分发 —— 它不读也不写任何 cookie（`rest_note_visit` / `rest_note_entered` 都不会被创建）、不参与 302、不读 `dist/`、不改任何访问状态。`GET` / `HEAD` → `200` + `Content-Type: text/plain; charset=utf-8` + `Cache-Control: no-store`，body 固定 `ok`；其它方法 → `405`（`Allow: GET, HEAD`）。
- **Render Blueprint**：仓库根目录的 `render.yaml` 声明这个 Web Service（`runtime: node`、Free plan、`branch: main`、`buildCommand: npm ci && npm run build`、`startCommand: npm run start:server`、`healthCheckPath: /health`、`autoDeployTrigger: commit`）；没有 disk / 数据库 / 写死的 PORT / 多余环境变量，Node 版本沿 `package.json` 的 `engines`（`>=22.12.0 <25.0.0`），不在 `render.yaml` 里重复设 `NODE_VERSION`。
- 手动新建服务时的等价配置：Build Command `npm install && npm run build`，Start Command `npm run start:server`。

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
| `space.position.v1.<id>` | sessionStorage | 每首曲子记下"暂停时的位置"（`identity:nocturne` 的夜曲进度也在这里，**换一趟访问不清理**） | `src/lib/live-timeline.ts` |
| `rest-note.visit` | sessionStorage | 这一趟访问的 id（跟着标签页走；新的一趟会换成新的） | `src/scripts/visit-session.ts`（判定在 `src/lib/visit.ts`） |
| `rest-note.entry-passed` | sessionStorage | **这一趟**已通过入场页；判定为新的一趟访问时清掉（只清这一个 key） | `src/scripts/visit-session.ts` |
| `space.scene-scroll` | sessionStorage | 离开"关于这一族"页面时记下的精确 `{ path, y }`；回来时取一次就清掉（第一帧直接落在原处） | `src/scripts/scene-scroll.ts` |
| `history.state.restNoteVisit` | 历史条目（不是存储） | 当前历史条目属于哪一趟访问：刷新会带着它（同一趟），地址栏重新输入网址则是新条目（新的一趟） | `src/scripts/visit-session.ts`（纯函数 `stampEntryToken()` / `readEntryToken()`） |
| `rest_note_visit` | cookie（HttpOnly，session 级） | **服务端**这一趟访问的 id（随机 token，`randomBytes(24)` → base64url）；网关补发，值不含任何信息 | `server/visit-cookie.ts`（§5.18） |
| `rest_note_entered` | cookie（HttpOnly，session 级） | **服务端**这个 session 有没有通过 Entry Gate（值只有 `1`）；由 `POST /api/enter` 写入，网关据此决定要不要拦子路由 | `server/visit-cookie.ts` + `src/scripts/entry-gate.ts`（§5.11 / §5.18） |

规则：所有读写都走 `src/scripts/storage.ts` 的封装（`readString` / `writeString` / `readNumber` / `readBool` / `writeNumber` / `writeBool`），隐私模式下静默降级，不抛异常。跨设备/长期偏好放 localStorage，一次性、会话内的放 sessionStorage。
例外：`visit-session.ts` 直接读 sessionStorage 是为了能一起处理"隐私模式下拿不到"（数组用的是 `try/catch` + 内存兜底），`history.state` 本来就不在 `storage.ts` 的管辖范围内。身份落点 cookie 名 `rest-note-identity-v3-<这一趟访问的 id>` 也跟着这里走（旧的 `rest-note.identity-visit` key 已不再使用）。
服务端那两个 cookie（`rest_note_visit` / `rest_note_entered`）**只能由 Node 网关读写**（HttpOnly，前端 JS 看不到，也不该看到）：它们只存随机 token 与 `1`，用途只有一个 —— 判断这个 session 能不能直接进子页面。

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
| `html[data-visit]` | `visit-session.ts`（`new` / `same`） | 只有排查时人读（脚本不读） | 这次文档加载被判成"新的一趟访问"还是"同一趟"——"为什么又弹入场页"先看它 |

### 主题 / 时钟 / 音乐

| 钩子 | 谁写 | 谁读 | 用途 |
| --- | --- | --- | --- |
| `[data-theme-switch]` / `-btn` / `-value` | `ThemeSwitcher.astro` | `initThemeSwitcher()` | 右下角主题控件（解锁后才存在） |
| `[data-clock]` / `-time` / `-date` / `-zone` | `LcdClock.astro` | `initClock()` | 访客所在地时间（IP 定位）+ UTC 偏移；城市名走 `.clock__city` |
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
| `[data-journey-section="about"][data-scene]` | `app.ts` 的 `initJourney()`（`active` / `idle`） | 只有排查时人读（脚本不读） | 关于区这一条"算不算在观看区域"（迟滞判定的结果，见 §5.16） |
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

### 2026-09-22 · LCD 时钟改成访客所在地时间 + 中文城市名走现有 Translate Worker

- 需求：把 LCD Clock 从"固定新加坡时间"改成**访客本地时间**（城市 / 时区 / UTC 偏移都跟随访客），中文版城市名要出中文；随后几轮追加：定位回来之前**一律空白**（不默认新加坡 / `UTC+08:00` / 占位时间）、IP 定位必须绕开旧缓存、中文城市翻译改用已有 Cloudflare Translate Worker、只对少数易错城市保留本地小字典。
- 实现：`src/scripts/clock.ts` 重写为"IP 定位 → 动态时区"：
  1. `fetch('https://ipwho.is/?_=<Date.now()>', { cache: 'no-store' })`（时间戳 + no-store 双保险，换 VPN / 换出口 IP 不会被旧响应黏住；同一文档只请求一次，模块级 Promise 缓存）；只取 `success` / `city` / `timezone.id`，并用 `Intl.DateTimeFormat` 校验时区名合法。
  2. 成功后立刻用该 IANA 时区建 `Intl.DateTimeFormat`（`time` / `date` / `zone`）并 `tick()`：时间、日期、UTC 偏移**立即**工作（不等翻译）；偏移用 `timeZoneName: 'longOffset'` 的 `GMT±HH:MM` 现算（`GMT → UTC+00:00`），拿不到时用"墙上时间与 UTC 之差"兜底 —— 不写死偏移、不维护 DST 表。
  3. 城市名三条路：英文页直接显示原始 `city`；中文页先查 `SPECIAL_CITY_ZH`（少量固定 / 易错译名，命中即用且**不发请求**，`seoul → 首尔` 就是防机翻成"汉城"）；未命中则 city 先空白 → `GET https://ximu-translate.yanfangwei467.workers.dev/?sl=en&tl=zh-CN&q=<原始 city>`（`URL` + `searchParams`，`cache: 'no-store'`）→ 严格按 `Array.isArray(data) && typeof data[0] === 'string' && data[0].trim()` 取译文，只更新城市名那一个节点；失败（网络 / 非 2xx / 解析 / 形状 / 空串）回退显示原始英文城市名。
  4. 定位回来之前 `tick()` 直接 return，四个动态文本全空（组件里两个初始占位是零宽空格，只为保住行高、避免真实时间到达时跳一下）；IP 失败也保持空白，不回退新加坡。
- 边界：时区 / 城市只存在内存（无 localStorage / sessionStorage、不持久化 IP / 城市）；翻译失败不弹错误、不重试、不 console spam；时钟仍然只有一个 `setInterval`。**Worker 地址目前写死在 `clock.ts` 的 `TRANSLATE_ENDPOINT`**（本人计划下一步再抽成环境变量 / Render Settings）。
- 文件：`src/scripts/clock.ts`、`src/components/LcdClock.astro`（`data-clock-zone` 钩子 + 初始文本空白）、`DEVELOPMENT.md`（§3 / §5.12 / §7 / 本条）。没碰 CSS / 布局 / 字体 / spacing / glass 效果 / Audio / MIDI / Entry Gate / Router / Server / Render 配置。
- 钩子/数据：新增 DOM 钩子 `[data-clock-zone]`；新增两个第三方请求（`ipwho.is` 定位、`ximu-translate.…workers.dev` 翻译，都只在浏览器端、不经服务器）；无新增 storage key。
- 验证：`npm run check` 112 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页；构建产物核对：`UTC+08:00` / `--:--:--` / `----.--.-- ---` 都不再出现在首页 HTML 里。真人浏览器（VPN 切地区）验证由本人完成：Seoul / Tokyo / Hong Kong / Taipei / Beijing / Los Angeles 以及至少一个字典外城市。

### 2026-09-22 · 增加外部子路由的轻量服务端首页重定向

- 只改 `server/index.ts`（+ §5.18 一行）：在 `/health` 之后、读 cookie 之前加一个小判断 —— 站内 HTML 页面 + `GET|HEAD` + `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document` + `Sec-Fetch-Site: none|cross-site` 且不是语言首页时，`302` 到 `languageHome(pathname)`（`/en...` → `/en/`，其余 → `/`）。
- 这是**纯 pathname 重定向**：不读不写 cookie、不动 `rest_note_visit` / `rest_note_entered`、不碰服务端 session，也不改客户端；重定向后的首页仍由客户端 `visitSession()` / Entry Gate 判定 NEW VISIT。刷新当前子页（`same-origin`）、站内 ClientRouter 导航、`/api/enter`、静态资源、`/health`、`/` 与 `/en/` 都不受影响。

### 2026-09-22 · 重构背景音乐状态机为单一播放意图与真实媒体状态

- 需求：本人要求把背景 MP3 从"`state` / `userPaused` / `audio.paused` / 各种 retry 路径互相修正"改成**单一事实来源**，长期问题一次收口：SAME VISIT 刷新后偶发不恢复、UI 显示播放但真实播放器没在跑、自动恢复与第一次点播放按钮竞争、换主题后暂停/继续跳回旧位置、放置一段时间或 visibility / pageshow 之后状态逐渐脱节。硬约束：**最大限度保持外围 API**（不改 `music-ui.ts` / `theme.ts` / `app.ts` / `entry-gate.ts` / `nocturne-transport.ts` 的调用方式）、不改 server / visit / cookie / Range / Fetch Metadata / Entry Gate / MIDI / PianoEngine / NocturneTransport / UI / 主题视觉 / 语言 / 滚动，不加 debug recorder、不加 setTimeout 兜底、不新建第二套 manager。
- 根因（旧设计的三处结构性缺陷）：①`private state: MusicState` 是一份**缓存出来的**播放状态，由 `setState()` 在十几个地方手写，于是"状态说 active、元素其实停着"这种分裂必然出现（`playing` / `pause` 事件、`attemptStart` 的 catch、`crossfadeTo` 的尾巴各写一套）。②播放意图是**反向**的 `userPaused`，再叠一个 `resumeAfterAbout` 去猜"进 About 之前想不想播"，两份意图互相修正。③`syncLive(el, id)` 在多条路径上（`loadedmetadata` / `attemptStart()` / `play()` / `crossfadeTo()`）用 storage 里的保存值覆盖 `currentTime` —— 同一个元素明明停在暂停处，`play()` 又把它拽回旧时间线（本人报的"换主题 → 放一会儿 → 暂停 → 播放会接近开头"）。
- 改动（`src/scripts/music-manager.ts` 内核重写 + `src/scripts/audio-unlock.ts` 拆 boot 双启动 + §5.5 文档）：
  1. **删掉缓存状态**：`private state`、`setState()` 全部移除，`getState()` 改为现场推导（`error` → `paused`（`!shouldPlay`）→ `paused`（About 让位）→ `active`（元素真在响）→ `ready`（有元素、想播没响）→ `idle`（还没建元素））。原生媒体事件只 `emit()`，让 UI 重新读现场。
  2. **意图正向化**：`userPaused` → `shouldPlay`（`shouldPlay = !readBool('space.paused')`，**storage key 不迁移、不动已有设置**）；删掉 `resumeAfterAbout`。只有 `play()`（true）、`pause()`（false）、换主题的 force 路径会写它。
  3. **About 只抢焦点**：`setAboutActive(true)` 归零音量 + 暂停所有主题 MP3 + 作废在飞操作，**不碰 `shouldPlay`**；`setAboutActive(false)` 只看 `shouldPlay` 决定恢复。About 期间换主题仍会切当前曲目（各自恢复自己的位置）但保持暂停。
  4. **进度只恢复一次**：新增 `positionRestored` / `positionRestorePending`（两个 `WeakSet`）与 `restorePositionOnce(el, id)` —— 接管一个元素时恢复一次；元数据没到就只挂**一个** `loadedmetadata`（用 `{once:true}` + pending 标记防重复挂）。`play()` / `resume()` 里的 `syncLive()` 删除，`syncLive()` 本身也删掉。
  5. **统一自动启动 + 并发保护**：`init()` / `retryIfIdle()` / `canplay` / `pageshow` / `visibilitychange` 全部汇入 `requestAutoStart()`（条件统一：`shouldPlay && !inAbout && autoStart && !isPlaying()`），用 `startInFlight` 单飞登记位保证同一时刻最多一条在飞；**显式 `play()` 也用同一个登记位** —— 入场页那次点击里 `music.play()` 紧跟的 `audioUnlock() → retryIfIdle()` 因此不会在同一个元素上并发第二次 `el.play()`。
  6. **过期操作无害化**：`switchToken` 在启动 / 切换 / 暂停 / 进出 About 时 +1；`startElement(el, token)` 在 `await el.play()` 回来后对号 —— 过期就只安静退场（元素已不是当前曲目时 `volume=0; pause()`），不改 `shouldPlay` / 不改 `this.el` / 不停新的播放。失败也不伪装状态：`getState()` 自然给出 `ready`。
  7. **切曲重构**：`crossfadeTo()` 切走前把旧曲进度落到它自己的 `space.position.v1.track:<id>`；新曲只在自己第一次被接管时恢复位置（用过的元素保留它自己的 `currentTime`）。**删掉先 `await waitForCanPlay()`（连同 `withTimeout()`）**：直接 `incoming.play()`（浏览器自己等媒体 ready），旧曲在它真正起播前继续响，成功后再交叉淡入；autoplay 被拒时保留 `shouldPlay`、曲目仍指向目标、状态 READY。
  8. **`audio-unlock.ts` 拆 boot 双启动**：拆出 `unlockNonMusic()`（琴 + "琴在跑且夜曲想播"时接上夜曲），`unlockAll()` = `unlockNonMusic()` + `music.retryIfIdle()`（手势那一路用）；`initAudioUnlock({gated:false})` 只调 `music.init()` + `unlockNonMusic()`，**不再补第二枪 MP3**。`EXPLICIT_AUDIO_CONTROL` / `isExplicitAudioControlGesture()` 的让位逻辑原样保留。
  9. `toggle()` 改成"`!shouldPlay` → play；真在播 → pause；想播没响 → play"，三种情况都对（autoplay 被挡住时不会再变成"暂停"）。`pause()` 保留 450ms 淡出，但 `play()` 会 `stopFades()` 把它连同"淡出结束再 `pause()`"的 `done` 一起取消（450ms 内又点播放的竞争）。
- 边界（明确没动）：`music-ui.ts`、`theme.ts`、`app.ts`、`entry-gate.ts`、`nocturne-transport.ts`、`piano.ts`、`src/lib/live-timeline.ts`、`src/lib/music.ts` 一行未改（外围 API 与语义保持兼容）；`server/**`、cookie、Range、Fetch Metadata、NEW/SAME VISIT、Entry Gate、语言 / 滚动、MIDI 调度全部零修改；没有新增 debug / setTimeout / start lock 之外的机制，也没有第二套 MusicManager。
- 文件：`src/scripts/music-manager.ts`、`src/scripts/audio-unlock.ts`、`DEVELOPMENT.md`（§5.5 / 本条）。
- 钩子/数据：无新增 / 删除 DOM 钩子与 storage key（`space.paused` / `space.volume` / `space.muted` / `space.position.v1.track:<id>` 全部沿用，格式不变）；`MusicManager` 对外接口与 `'change'` 事件不变。
- 验证：`npm run check` 112 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求没有起 dev / preview、没有浏览器 / Playwright / CDP，真实浏览器验证由本人完成（重点：刷新后自动恢复、第一次点播放生效、换主题与暂停继续各自的位置、About 往返后的意图保留）。

### 2026-09-22 · 增加 Render Web Service Blueprint 与健康检查

- 需求：只做 Render Web Service 的部署配置 —— ①`server/index.ts` 加一个最小健康检查 `GET /health`（必须在 Entry Gate / cookie / 静态路由判断**之前**处理；`200` + `text/plain; charset=utf-8` + `Cache-Control: no-store`，body `ok`；`HEAD /health` 也允许 `200` 且可不写 body；不创建 `rest_note_visit` / `rest_note_entered` cookie、不参与 Entry Gate redirect、不读 `dist`、不改任何访问状态）；②仓库根目录新增 `render.yaml`（不配 disk / 数据库、不写死 PORT、不加无用环境变量、不改 Docker / Astro SSR）；③Node 版本继续用 `package.json` 的 `engines`，不在 `render.yaml` 里重复设 `NODE_VERSION`。
- 改动：
  1. `server/index.ts`：新增常量 `HEALTH_PATH = '/health'` / `HEALTH_BODY = 'ok'`；`handleRequest()` 里在解析完 pathname 之后、`isSecureRequest()` / `readEntryCookies()` / `decideEntry()` 之前插入 `/health` 分支 —— `GET`/`HEAD` 回 `200`（`HEAD` 只发头不写 body，`Content-Length: 2` 与实际 GET 一致），其它方法回 `405` + `Allow: GET, HEAD`。**没有经过任何 cookie 逻辑**，所以健康检查不会给 Render 的探针发 session cookie，也不会污染访问状态。
  2. 新增 `render.yaml`：`type: web` / `name: the-rest-note` / `runtime: node` / `plan: free` / `branch: main` / `buildCommand: npm ci && npm run build` / `startCommand: npm run start:server` / `healthCheckPath: /health` / `autoDeployTrigger: commit`。就这些，没有别的字段。
- 明确没碰：Entry Gate session 语义、两个 cookie 的属性与读写、`/api/enter`、静态文件服务与防 traversal、AudioContext、MIDI、MusicManager、`visit-session`、`BaseHead`、Header、scroll。
- 文件：`server/index.ts`、**新增** `render.yaml`、`DEVELOPMENT.md`（§5.18 / 本条）、`README.md`（部署章节补 `/health` 与 blueprint）。
- 钩子/数据：新增一个 HTTP 端点 `GET|HEAD /health`（不写 cookie、不落任何状态）；没有新增 data-* 钩子、storage key、自定义事件或环境变量。
- 验证：`npm run check` 112 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页；另按同等级许可用 `node --experimental-strip-types --check server/index.ts` 做了一次 Node TypeScript 语法检查（通过）。按要求没起服务、没跑浏览器 / CDP / Playwright。

### 2026-09-22 · 增加 Node Web Service 入口网关与 Entry Gate 服务端会话

- 需求：把项目从"纯 Render Static Site"改造成"静态 Astro 前端 + 极薄 Node Web Service 网关"。**不是 Astro SSR**：Astro 仍然只 `npm run build` 出 `dist/`，Node 只管 ①HTTP 入口判断 ②中英文 NEW VISIT 入口重定向 ③Entry Gate 的服务端 session/cookie ④`dist/` 静态分发。前端逻辑（MIDI / AudioContext / scene / scroll / SPA / 入场页动画与音频解锁）一律不上服务器；不引 Express / 任何 server framework；后端继续用 TypeScript（Node 直接 `--experimental-strip-types` 跑）；不许改 MIDI / PianoEngine / AudioContext / NocturneTransport / identity physics / About observer / Header active / scene-scroll / 语言动画 / MusicManager / live timeline / theme / MiniLab。
- 根因 / 动机：原来"NEW VISIT 不许直接落在子页面"只能靠客户端（`BaseHead.astro` 早期脚本里的 `location.replace`），那要先下载、解析一段子页 HTML 才跳走，而且是"HTTP 层根本没拦"——真实入口语义应该由服务器决定。`#fragment` 服务端看不到，所以首页那部分仍然留在客户端。
- 改动：
  1. **新增 `server/entry-router.ts`**（纯判定，不碰 fs / res）：`languageHome()`（pathname 第一个非空 segment 是不是 `en` → `/en/`，否则 `/`）、`isHtmlPagePath()`（`/_astro/`、`/api/`、带静态后缀的一律不算 HTML）、`isLanguageHomePath()`（`/`、`/en`、`/en/`）、`decideEntry()` 返回 `enter` / `method-not-allowed` / `redirect` / `static`。
  2. **新增 `server/visit-cookie.ts`**：`rest_note_visit`（随机 token，`randomBytes(24)` → base64url）与 `rest_note_entered`（值只有 `1`），都是 `HttpOnly; SameSite=Lax; Path=/` + HTTPS 时 `Secure`，session 级（不写 Max-Age，对齐客户端 sessionStorage 的"这一趟"语义）；只存随机 token 与 `1`，不放敏感信息，网关无状态。
  3. **新增 `server/index.ts`**：`node:http` 起服务，`PORT` 读 `process.env.PORT`（默认 3000）监听 `0.0.0.0`；未进门时的子路由 `302` 回本语言首页（不带 query、不记原路由）；`POST /api/enter` → 写 `rest_note_entered=1` + `204 No Content`；`dist/` 静态分发（HTML 用 `no-cache` + `Vary: Cookie`，`/_astro/` 用 `immutable`），**防 path traversal**（`resolveInsideDist()` 先 `path.resolve` 规范化再要求落在 `DIST_ROOT` 内）；`SIGTERM` 优雅关闭。
  4. **`package.json`**：新增 `"start:server": "node --experimental-strip-types --disable-warning=ExperimentalWarning server/index.ts"`；`dev` / `check` / `build` / `preview` / `test` 原样未动。
  5. **`src/scripts/entry-gate.ts`**：点"进入空间"时在 `visit.markEntered()` 之后加一句 `void fetch('/api/enter', { method: 'POST', credentials: 'same-origin' }).catch(() => {})`。**不 await**（硬约束）：下面的 `stopNocturneTransport()` / `music.play()` / `audioUnlock()` / `requestMotionAccess()` / `primeMiniLabPiano()` 全部留在同一次点击的同步可信手势里；一旦 await，iOS 会丢 trusted user activation，音频解锁失败。fetch 失败不影响进站（本地 `hasEntered()` 那套照旧）。
  6. **`src/components/BaseHead.astro`**：删掉"子路由 `location.replace(target)`"那一支（服务端已经负责，避免两套实现漂移）；**保留** `#home` / `#blog` / `#lab` / `#about` 的首页早期清理（`#fragment` 服务端看不见）。首页判定仍按 pathname 第一个非空 segment，写法与服务端一致。
  7. 文档：README 的部署章节新增"Render Web Service（静态前端 + 极薄 Node 网关）"；DEVELOPMENT.md 新增 §5.18、更新 §1 / §2.2 / §5.11 / §5.15 / §6.1 / 本条。
- 请求流程（生产）：`GET /blog/x/`（无 `rest_note_entered` cookie）→ `decideEntry` 判 HTML 子路由 → `302 /`；`GET /en/about/` → `302 /en/`；`GET /`、`/en/` → 200 首页 HTML（Entry Gate 出现，语言按 `<html data-lang>`）；点"进入空间" → `POST /api/enter`（不 await）→ `Set-Cookie: rest_note_entered=1` + `204`；此后 `GET /blog/x/` 正常 200；`/_astro/*.js`、图片、`rss.xml`、sitemap、robots 全程按静态资源 200，永不重定向。
- 文件：**新增** `server/index.ts`、`server/entry-router.ts`、`server/visit-cookie.ts`；改 `package.json`、`src/scripts/entry-gate.ts`、`src/components/BaseHead.astro`、`README.md`、`DEVELOPMENT.md`。
- 钩子/数据：新增两个 **cookie**（`rest_note_visit` / `rest_note_entered`，HttpOnly，只有网关读写，见 §6.1）与一个 **HTTP 端点** `POST /api/enter`；没有新增 data-* 钩子或自定义事件，前端 storage key 一个没动。
- 验证：`npm run check` **112 个文件 0 错误 0 警告 0 提示**（server/*.ts 在 tsconfig 的 `**/*` 范围内，所以 astro check 覆盖到了它们）；`npm run build` 19 页；另外按"server TS 不在 astro check 范围时允许一次语法级检查"的许可，用 `node --experimental-strip-types --check` 逐个确认了三个 server 文件的语法（3/3 通过）。按本人要求这轮不启动浏览器 / Playwright / CDP，也没有起服务做端到端请求。

### 2026-09-22 · 统一 NEW VISIT 入口语言与 Entry Gate 页面语言

- 需求：本人要求把 NEW VISIT 的"目标语言"做成**真正的页面语言语义**，而不是 pathname 字符串补丁：英文入口（`/en`、`/en/`、`/en/...`）canonical 到 `/en/`，入场页显示英文，Enter 后停在 `/en/`；中文入口（`/` 及第一段不是 `en` 的其它路径）canonical 到 `/`，入场页显示中文，进入后停在 `/`。用户系统语言不许覆盖 URL / 页面语言。只修两处：NEW VISIT 英文入口识别 + Entry Gate 文案语言来源；NEW/SAME 判定、`visit-session.ts`、`lib/visit.ts`、入场页动画与音频解锁、scroll restoration、Header、language switch、MIDI / AudioContext、MusicManager、About observer 都不许动。
- 现状核对：第 1 处（`BaseHead.astro` 的语言判断）在上一条 `60dd625` 里已经是 segment 形式了 —— `var parts = location.pathname.split('/').filter(Boolean); var isEnglish = parts[0] === 'en'; var target = isEnglish ? '/en/' : '/';`，`/en`、`/en/`、`/en/blog/...`、`/en/about/intro/...` 全判英文，其余全判中文，本轮**没有再改它**（也没有别的字符串条件）。真正要修的是第 2 处。
- 根因（第 2 处）：`entry-gate.ts` 的 `applySystemLanguage()` 用 `navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'` 挑文案 —— 这是**系统语言**，和"这一页是哪一版"没有关系。于是"系统中文 + 打开 `/en/`"会得到英文首页配中文入场页；入口语言由 URL 决定之后，这两套来源必然打架（本人报的问题）。
- 改动（只改 `src/scripts/entry-gate.ts` + 文档）：`applySystemLanguage()` → `applyPageLanguage()`，语言来源换成当前文档：`const language = document.documentElement.dataset.lang === 'en' ? 'en' : 'zh';`（`<html data-lang>` 由 `BaseLayout.astro:48` 按页面 `lang` 渲染）。`[data-entry-copy]` + `data-zh` / `data-en` 的换字逻辑、`aria-label`、`gate.dataset.language`、`is-ready`、点"进入"的整条链路（`markEntered()` / `stopNocturneTransport()` / `music.play()` / `audioUnlock()` / `requestMotionAccess()` / `primeMiniLabPiano()` / 收尾去锚点与拉回顶部）全部原样。
- 结果（NEW VISIT）：`/en` → `/en/` + 英文入场页 → 英文首页；`/en/about/intro/` → `/en/` + 英文入场页 → 英文首页；`/about/intro/` → `/` + 中文入场页 → 中文首页。SAME VISIT（刷新子页 / 站内导航 / 前进后退 / 语言切换）仍然留在原路由，入场页那一趟也不会再冒出来（判据还是 `hasEntered()`，没动）。
- 文件：`src/scripts/entry-gate.ts`、`DEVELOPMENT.md`（§5.11 / §5.15 已是最新 / 本条）。`src/components/BaseHead.astro` 本轮零改动。
- 钩子/数据：无新增 / 删除 data-* 钩子、storage key、自定义事件（`[data-entry-gate]` / `[data-entry-button]` / `[data-entry-copy]` 与 `data-zh` / `data-en` 语义不变，`gate.dataset.language` 照旧反映当前语言）。
- 验证：`npm run check` 109 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求这轮不跑浏览器 / CDP / Playwright，`/en`、`/en/about/intro/`、`/about/intro/` 三条入口的实机行为由本人确认。

### 2026-09-22 · 修复 `/en` 无尾斜杠时被误判为中文入口

- 需求：本人报 NEW VISIT 打开 `/en`（无尾斜杠）时被错误重定向到中文首页；要求只修这一处语言路由识别，不要用"再补一个 `location.pathname === '/en'`"的办法，改成按 pathname 的第一个 segment 判语言；NEW/SAME 判定、Entry Gate、`location.replace` 规则、Journey hash 清理、language switch、Header、音频、scroll restoration、`visit-session.ts`、`lib/visit.ts` 都不许动。
- 根因：`BaseHead.astro` 那段 early normalizer 里写的是 `location.pathname === '/en/' || location.pathname.startsWith('/en/')` —— `'/en' !== '/en/'` 且 `'/en'.startsWith('/en/') === false`，于是 `/en` 算成中文，`target` 取 `'/'`，NEW VISIT 被 `location.replace('/')` 送到中文版首页。
- 修法：语言判断换成"第一个非空 segment 是不是 `en`"：
  ```js
  var parts = location.pathname.split('/').filter(Boolean);
  var isEnglish = parts[0] === 'en';
  var target = isEnglish ? '/en/' : '/';
  ```
  一次覆盖 `/en`、`/en/`、`/en/blog/...`、`/en/about/intro/...`（全 → `/en/`）；`/`、`/blog/...`、`/about/...` 仍 → `/`。没有新增字符串条件，也没有碰脚本里其它任何一行（NEW/SAME 判定、`location.replace(target)` 整体规则、首页四个 Journey hash 清理都原样）。
- 文件：`src/components/BaseHead.astro`、`DEVELOPMENT.md`（§5.15 / 本条）。
- 钩子/数据：无新增 / 删除 data-* 钩子、storage key、自定义事件。
- 验证：`npm run check` 109 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求这轮不跑浏览器 / CDP / Playwright，`/en` 与 `/en/...` 的实机行为由本人确认。

### 2026-09-22 · NEW VISIT 统一归一化到对应语言首页

> **同日后续（已拆分职责）**：子路由 `location.replace('...')` 那一半已搬到服务端网关（`server/entry-router.ts` 的 302），客户端只保留首页 Journey hash 的早期清理。见本条上面几条日志与 §5.18。

- 需求：本人确定最终语义 —— **任何"站内 HTML 页面"的 NEW VISIT 都不允许直接落在子页面**：中文所有站内路由 → `/`，英文（`/en/...`）→ `/en/`，然后正常显示 Entry Gate；用户点过"进入空间"以后就停在首页，**不再跳回原始子页**。示例：`/blog/a-nocturne-for-you/`、`/about/`、`/about/intro/`、`/lab/...` → `/`；`/en/blog/...`、`/en/about/intro/` → `/en/`。SAME VISIT 一律不受影响（站内点击文章、About → Intro、返回、前进后退、刷新当前页、语言切换都留在原页面）。仍然不许服务器 301/302、不许改 Render 配置、不许加 `_redirects`；不许叠第三套判断；`app.ts` 不许再新增重定向逻辑。
- 根因（为什么必须提前到 `<head>`）：①fragment 与"当前是子页"这件事在托管层都无从下手（fragment 根本不进 HTTP 请求，静态托管的 rewrite 也只能把请求打到同一个 HTML）；②放在 `app.ts` 的 `boot()` 里太晚 —— 浏览器在解析到 section id 时已经执行过原生 fragment 定位（关于区 observer、夜曲、身份物理都被带起来），而且子页正文已经先渲染过一帧。
- 改动（只改 `src/components/BaseHead.astro` + 文档）：
  1. 把上一版"只在 `'/'` / `'/en/'` 且 hash 是那四个时才清 hash"的 early normalizer **升级为统一规则**（原地替换，没有第二、第三套判断）：先判 NEW/SAME（照抄 `lib/visit.ts` 的 `visitBoundary()`：无 session token → NEW；`navigate` → NEW；`reload` → `history.state.restNoteVisit === session token` 才 SAME，否则 NEW；`back_forward` → SAME；拿不到 / 认不出 type → NEW；`sessionStorage` / `history.state` / `performance` 的读取各自 try/catch）。
  2. **SAME VISIT 立即早退**：刷新子页、站内点击文章、About → Intro、返回、前进/后退、语言切换（ClientRouter 的 `navigate()`，本来就不产生文档加载）都留在原路由，hash 也不动。
  3. NEW VISIT：`location.pathname === '/en/' || startsWith('/en/')` → target `'/en/'`，否则 `'/'`。`pathname !== target` → `location.replace(target)`（replace 不留子页历史条目、不继承 query/hash、不用 `pushState`、不把原 pathname 存起来准备"进入后跳回"）；`pathname === target` → 只把 `#home` / `#blog` / `#lab` / `#about` 从地址栏抹掉（`history.replaceState(history.state, '', pathname + search)`，保留现有 search）。
  4. 静态资源不写任何判断：`/_astro/`、图片、favicon、sitemap、`rss.xml`（`src/pages/rss.xml.ts` 的 API 路由）、`robots.txt` 都不经过 `BaseHead.astro`，脚本里没有也不需要白名单。
- 为什么子页直链会被 replace 到首页：脚本在 `<head>` 里、正文还没解析就执行，`location.replace()` 把当前这条子页历史条目**换成**目标首页（不新增条目、不留子页），页面于是以 `navigate` 类型重新加载 `/` 或 `/en/`；那一趟仍然判为 NEW（类型是 `navigate`；即使被报成 `reload`，replace 出来的新条目 `state` 为空、章对不上也是 NEW），而首页自己算出的 target 就是自己 → 不会再跳、不会死循环，Entry Gate 正常出现。
- 为什么 SAME VISIT 刷新 / 站内导航不受影响：判定为 SAME 时脚本在做任何动作之前就 `return` —— 刷新子页（`reload` + 条目上的章一致）、ClientRouter 站内导航（不产生文档加载，脚本根本不跑）、前进后退（`back_forward`）、语言切换（同上）全都留在原路由，`visitSession()` / `visitBoundary()` 的正式逻辑与 `app.ts` 的 scroll restoration 一行未动。
- 明确没碰：`visit-session.ts` 的 token 创建、`visitBoundary()`、Entry Gate 动画/按钮、scroll restoration、Header（点击导航与蓝杠）、language switch、MIDI / AudioContext、About observer、live-timeline、scene-scroll、MusicManager。
- 文件：`src/components/BaseHead.astro`、`DEVELOPMENT.md`（§5.15 / 本条）。`app.ts` 本轮零改动（它已经没有任何重定向 / NEW-SAME 判定）。
- 钩子/数据：无新增 / 删除 data-* 钩子、storage key、自定义事件（脚本只读 `rest-note.visit` 与 `history.state.restNoteVisit`，一个字节都不写）。
- 验证：`npm run check` 109 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求这轮不跑浏览器 / CDP / Playwright，四种直链的实机行为由本人确认。

### 2026-09-22 · 将 NEW VISIT Journey hash 规范化提前到 `<head>`（不删 `app.ts` 的 NEW VISIT / restoreScroll(0) 逻辑）

> **同日后续（已被取代）**：这一版只处理"已在 Journey 首页 + 那四个 hash"，且 SAME VISIT 之外的子页仍然直接落在子页上。现在 `<head>` 里那段脚本已升级为"NEW VISIT 统一归一化到对应语言首页"，见上一条。

- 需求：本人要求把上一版（`e07d8fd`）放在 `app.ts` `boot()` 里的 Journey hash 规范化，改成"**全站部署、局部生效**"的 early normalizer：`src/components/BaseHead.astro` 的 `<head>` 里一段同步 `is:inline` 脚本，必须在浏览器解析到对应 section id、执行原生 fragment scroll **之前**跑完（不等 DOMContentLoaded / `astro:page-load` / `requestAnimationFrame` / `app.ts` 的 boot）。不许服务器 301/302、不许改 Render 配置、不许加 `_redirects`；不许保留两套可能漂移的 NEW/SAME 判定。
- 根因（为什么 `boot()` 里太晚）：`app.ts` 是模块脚本，而 `boot()` 还要等到 DOMContentLoaded / `astro:page-load`，这时浏览器**已经**按 URL 里的 `#about` 之类做过一次原生 fragment 定位了 —— 那一下足以把关于区 observer 判成 active、拉起夜曲与身份物理，之后我们再 `restoreScroll(0)` 只是补救；而且 URL 里的 hash 还在，会话恢复 / 布局抖动时会被再锚一次。服务器侧无解：fragment 不进 HTTP 请求。
- 改动：
  1. **`src/components/BaseHead.astro`**：紧跟 viewport meta、在主题脚本之前新增 `is:inline` 同步脚本（不再有第二个早期脚本）。全站每个 HTML 页面都会跑，但先做两个提前退出：`location.pathname === '/' || '/en/'`，且 `location.hash` 严格属于 `['#home','#blog','#lab','#about']`。任一条不成立就直接 return。
  2. 判定 NEW VISIT 时不引模块代码，照抄 `lib/visit.ts` 的 `visitBoundary()` 语义：没有 `rest-note.visit` → NEW；`navigate` → NEW；`reload` → `history.state.restNoteVisit === session token` 才 SAME，否则 NEW；`back_forward` → SAME；拿不到 / 认不出 type → NEW。`sessionStorage` / `history.state` / `performance` 的读取各自 try/catch 兜底（隐私模式读不到就当新访问）。
  3. 三个条件（NEW + Journey 根 + 那四个 hash）同时成立时，只做一次 `history.replaceState(window.history.state, '', location.pathname + location.search)`：只去 hash，不动 pathname / search / `history.state`，不 reload、不走 `location.replace`、不新增历史条目、不写 sessionStorage、不建新的 visit token；`replaceState` 自身也包了 try/catch（file:// / 沙盒 iframe 下会抛）。
  4. **`src/scripts/app.ts`**：删掉上一版加进去的那段 `JOURNEY_HASHES` + `boot()` 里的 NEW VISIT hash cleanup（那 32 行整体回退）。`boot()` 里其余 NEW VISIT 分支与 `restoreScroll(0)`、SAME VISIT 的恢复逻辑一行未动 —— 只是不再有第二份 NEW/SAME 判定。
- 为什么文章锚点与其它直链不受影响：脚本在处理任何事之前就按"是不是 Journey 首页 + 是不是那四个已知 hash"退出 —— `/blog/...`、`/en/blog/...` 的文章直链与文章内部任何 `#heading`（pathname 不是 `/` 或 `/en/`）、`/lab/...` 独立页、图片与 `/_astro/...` 静态资源（根本不执行这段 HTML 或 pathname 不匹配）都不进入；以后新增的其它 hash 也不在那四个白名单里。SAME VISIT 下连那四个 hash 都保留（点 Header 跳 `#about`、普通刷新留在当前区块、前进/后退照旧）。
- 明确没碰：`visitSession()` / `visitBoundary()` 正式逻辑、Entry Gate（它自己那次"进站抹遗留锚点"保持原样）、SAME VISIT scroll restoration、Header 点击导航与蓝杠、About observer、`sceneCoverage` / `sceneDecision`、MIDI / AudioContext、语言切换、live-timeline、scene-scroll、MusicManager。
- 文件：`src/components/BaseHead.astro`、`src/scripts/app.ts`（回退旧兜底）、`DEVELOPMENT.md`（§5.15 / 本条，并给上一条日志加了指向本条的前向说明）。
- 钩子/数据：无新增 / 删除 data-* 钩子、storage key、自定义事件（脚本只读 `rest-note.visit` 与 `history.state.restNoteVisit`，一个字节都不写）。
- 验证：`npm run check` 109 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求这轮不跑浏览器 / CDP / Playwright，地址栏输入四种 hash 的实机行为由本人确认。

### 2026-09-22 · NEW VISIT 带 Journey hash 的入口规范化（只抹 `#home/#blog/#lab/#about`）

> **同日后续（已被取代）**：这一版放在 `app.ts` `boot()` 里太晚 —— 浏览器的原生 fragment 定位已经发生。现在改到 `BaseHead.astro` 的 `<head>` 早期脚本，`app.ts` 里这段兜底已删，见上一条。

- 需求：本人报"直接在地址栏输入 `https://the-rest-note.onrender.com/#home|#blog|#lab|#about`"时，浏览器自带的 fragment 定位会参与初始页面状态，可能绕过 / 干扰"NEW VISIT 必须从 Home + Entry Gate 开始"的语义，并进一步影响滚动、About scene、MIDI。要求只在客户端处理（fragment 不发给服务器，不许改托管层、不许加 301/302 / `_redirects`）：NEW VISIT 且当前是 Journey 首页且 hash 属于那四个时，用 `history.replaceState()` 只去掉 hash；SAME VISIT 一律不动；只做这一件事。
- 根因：`app.ts` 的 NEW VISIT 分支只把初始滚动目标定成 `restoreScroll(0)`，但地址栏里那次遗留 `#about` 之类的 fragment 是**浏览器**在文档加载时自己定位的：它会先把页面滚到那个区块（进而让关于区 observer 判定 active、拉起夜曲与身份物理），等我们的 `restoreScroll(0)` 跑完，URL 里那个 hash 还在 —— 后续布局抖动 / 会话恢复时还会被再锚一次。服务器侧无解：`#hash` 根本不进 HTTP 请求。
- 改动（只改 `src/scripts/app.ts` + 文档）：
  1. 模块级新增 `JOURNEY_HASHES = ['#home', '#blog', '#lab', '#about']` —— 只认这四个已知 id。
  2. `boot()` 里拿到 `const isNewVisit = visitSession().isNew;` 之后、`restoreScroll(0)` 之前插入规范化：`isNewVisit && journey && JOURNEY_HASHES.includes(location.hash)` 时 `history.replaceState(history.state, '', location.pathname + location.search)`。
  3. 判定"当前是不是 Journey 首页"用已有的 `journey`（`document.querySelector('[data-journey]')`）而不是比 pathname：`[data-journey]` 只在 `JourneyPage.astro` 渲染，等价于"/ 与 /en/"，而客户端脚本引不了 `lib/pages.ts`（那份文件带 `astro:content`）。
- 边界（明确没动）：不改 `visitSession()` 的判定规则、不改 Entry Gate（它自己那次"进站抹遗留锚点"保持原样）、不改音频 / About observer / SAME VISIT 的 `restoreScroll` / scene-scroll / Header 蓝杠 / 语言切换；不是 reload、不走 `location.replace`、不产生新历史条目，`pathname` / `search` / `history.state`（访问章 + Astro 的 index / scrollY）原样保留。
- 文件：`src/scripts/app.ts`、`DEVELOPMENT.md`（§5.15 / 本条）。
- 钩子/数据：无新增 / 删除 data-* 钩子、storage key、自定义事件。
- 验证：`npm run check` 109 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求这轮不跑浏览器 / CDP / Playwright，地址栏输入四种 hash 的实机行为由本人确认。

### 2026-09-22 · AudioContext 被系统打断后 NocturneTransport 的假 playing / 自动接回

- 需求：本人报当天第 3、4 个音频问题，按同一条状态链处理。**现象 A**：从 Header 点 About、平滑滚动进入关于区后 MIDI 有时不真正出声；**现象 B**："幽灵演奏"——播放按钮显示暂停态（UI 认为 `playing`）、时间已经走到 0:06、琴键/瀑布流停在某一帧不再推进、实际没有声音。要求真正修 transport 的运行状态同步，不许只改 UI、不许在 `identity-player.ts` 里改按钮状态，也不许给 Header → About 加"直接 start MIDI"的新路径。
- 根因：`NocturneTransport` 自己有一份 `playing`，而"能不能出声"取决于 `PianoEngine.isRunning`（AudioContext 是否 `running`）。`piano:context` 监听过去只处理**一个方向**（`isRunning === true` 时若 `desired && !playing` 就 `begin()`）：iOS / Safari 把 AudioContext 从 `running` 变成 `suspended` / `interrupted` 时，没人把 `playing` 同步回 `false`。于是 ①`isPlaying()` 一直返回 `true`，UI 继续显示"正在播放"；②`position()` 走的是冻住的 `piano().currentTime - origin`，视觉停在某一帧；③`audio-unlock.ts` 那句 `if (transport?.isDesired() && !transport.isPlaying()) transport.start()` 永远不成立，后续真实手势也不会把播放接回来 —— 这既是"幽灵演奏"，也是现象 A 里"进了 About 却没声"的那条链。
- 改动（只改 `src/scripts/nocturne-transport.ts` + 文档）：
  1. `piano()` 里的 `piano:context` 监听补齐**反方向**：`piano.isRunning === false` 且 `this.playing === true` 时调 `this.suspend()` —— 它本来就是这个语义：存下此刻位置（`offset` + `savePosition()`）、清掉排程 timer、`allNotesOff()`、`playing = false`、`notify()`（UI 退出假 playing），而 **`desired` 不动**（`suspend()` 从不碰它，只有 `pause()` / 离开场景才清）。
  2. 没有新造第二套状态机，也没有新增 `suspend()` 的调用语义分支：系统打断与切后台 / 主动暂停共用同一个 `suspend()`，只在注释里写清"这一路不清 desired"。
  3. 上下文回到 `running` 时，原来那一支 `isRunning === true` 分支看到 `desired === true && playing === false && !loading` → `begin()`；`begin()` 里 `resumeOffset()` 用的是 `suspend()` 刚存下的 `offset`（`resumed` 已经是 `true`，不再去读 `live-timeline`），所以**从打断处接着弹，不从头开始**。
- 明确没动的语义：用户点暂停（`pause()`）与离开 About 场景（`stop()` → `pause()`）仍然清 `desired`；系统 `suspended` / `interrupted` / iOS 音频会话被打断只让 `playing = false` 并保留 `desired`。Header → About 那条链（`pointerdown` → audio-unlock → `primeIdentityPiano()` → `ensure/resume`；`click` → 平滑滚动；场景 active → `initIdentity()` → `setIdentityActive(true)` → `transport.start()`）一行未改，也没有新增任何"点 About 就 start MIDI"的路径。
- 文件：`src/scripts/nocturne-transport.ts`、`DEVELOPMENT.md`（§5.14 / 本条）。没碰 `app.ts` 的 Header 蓝杠、`sceneCoverage` / `sceneDecision` 阈值、About IntersectionObserver、Entry Gate、`visit-session` / NEW VISIT、滚动恢复、语言切换、MusicManager、live-timeline 的 NEW VISIT reset、`identity-player.ts` 的 UI 架构、PianoEngine 的采样下载策略、autoplay 绕过。
- 钩子/数据：无新增 / 删除 data-* 钩子、storage key、自定义事件（仍是既有的 `piano:context` / `piano:state`）。
- 验证：`npm run check` 109 个文件 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求这轮不跑浏览器 / CDP / Playwright，真机（iOS 音频会话打断 → 恢复）由本人确认。

### 2026-09-22 · Header 两处状态修正：导航蓝杠按视口观察线判定 + 界面语言以 URL/document 为准

- 需求：本人报两个 Header UI 状态问题，并要求只碰这两处、不碰当天已经稳定的 NEW VISIT / 音频 / 滚动恢复架构。①导航蓝杠（Home / Blog / Lab / About）必须始终表示"当前视口最接近、正在观看的区块"，点击平滑滚动 / 滚轮 / 触摸 / 键盘滚动 / 刷新恢复位置都要同步；②中英文 Header 状态偶尔错乱（英文页面配中文导航）。
- 根因：
  1. `initJourney()` 的 `sectionObserver` 用 IntersectionObserver 回调里**本次传进来的 `entries`**：它只包含这一帧跨越阈值的元素，`filter(isIntersecting).sort(intersectionRatio)[0]` 拿到的不是"视口最接近的区块"；加上 `rootMargin: -34% / -52%` 那条窄带，点击平滑滚动时蓝杠可能仍停在 Home、手动滚动会滞后、交界处看起来像跳错。
  2. `lang.ts` 的 `initLangSwitch()` 里有 `if (preferred && preferred !== pageLang) swapChrome(preferred)`：URL 明明是 `/en/...`，而 localStorage `space.lang` 还留着 `zh` 时，导航文案又被改回中文；而 Header 的语言当前态是 Astro 按 URL 渲染的，两边打架。
- 改动：
  1. **导航蓝杠（`src/scripts/app.ts`）**：删掉 `sectionObserver`（它只负责 `aria-current`，不留两套 active 判定抢状态）；新增 `updateActiveSection()` —— 取固定视口观察线 `line = headerBottom + (innerHeight - headerBottom) * 0.35`（header 底边以下 35%），观察线落在哪个区块的 `rect.top ~ rect.bottom` 内就是 active，暂时不落在任何区块时取"区块中心离观察线最近"的那个，统一写 `aria-current="page"` / 清其余；`scroll` / `resize` 用 `requestAnimationFrame` 节流，初始化立刻算一次；点击导航**不**手工指定蓝杠，平滑滚动中由滚动事件自然跟随；`disposeJourney()` 解绑两个监听并 `cancelAnimationFrame` 挂起的那一帧。**About 的 `aboutObserver` / `sceneCoverage` / 音乐让位一行未动**。
  2. **语言真相（`src/scripts/lang.ts`）**：删掉那次偏好覆盖，改成每次 boot `swapChrome(pageLang)` —— 当前 URL / document 语言是唯一真相；`getPreferredLang()` 只保留"用户以后选了什么"的语义（`music-ui` / `theme-switch` / `easter-eggs` 的动态文字仍在用），不参与页面语言判定、不触发跳转。语言切换导航自身（`writeString` + `navigate` + 滑出滑入 + 滚动位置 + `space.lang-swap` 记号）与 Header 的语言 current（Astro 按 URL 渲染的 `span.is-current`）都未改。
- 文件：`src/scripts/app.ts`、`src/scripts/lang.ts`、`DEVELOPMENT.md`（§3 / §10）。没碰 `Header.astro`（`[aria-current='page']` 那条 CSS 原样用）、Entry Gate / audio-unlock / MusicManager / nocturne / scene-scroll / visit-session / history.state。
- 钩子/数据：没有新增 / 删除 data-* 钩子或 storage key；`html[data-lang]` 语义由"渲染语言"变成"唯一页面语言真相"（这正是本次的修法）。
- 验证：`npm run check` 0 错误 0 警告 0 提示；`npm run build` 19 页。按本人要求这轮不跑浏览器 / CDP 测试，实机验证由本人完成。

### 2026-09-22 · 内容：双语开发日记《为你弹奏肖邦的夜曲》/《A Nocturne for You》

- 需求：本人自己写好中英双语正文，要求按 README「写内容」那一节的方式上传成一篇博客（中英各一份、文件名配对），不改代码。
- 改动（只加内容 + 本条日志）：
  1. 新增 `src/content/blog/a-nocturne-for-you.zh.md` 与 `src/content/blog/a-nocturne-for-you.en.md`：文件名同 slug（`a-nocturne-for-you`），frontmatter `lang` 与后缀一致，`pubDate: 2026-09-22`，`tags: ["Notes", "Dev"]`。
  2. 正文一字未改，只在两端各自补上 frontmatter：中文 `title: 为你弹奏肖邦的夜曲`，英文 `title: A Nocturne for You`；`description` 各写一句概括。
  3. 两篇 slug 相同 → 右上角语言切换会停在「同一篇」（`getTranslation()` 按 slug 配对，见 §5.2 / §5.4）。
  4. 同日后续：本人补了完整扩写版（多出「浏览器：你说自动播放？我说不行」「音频重新进站了，时间线却没有」「先遮住它，还是重新定义它？」等整节，正文分十三节），按**同一个 slug 覆盖更新**这两份文件（没有新增第二篇同名文章），`description` 相应改成"史山"那一层意思。
- 背景（这篇写的就是这轮修的几个 Bug，细节见下面几条日志）：①NEW VISIT 时音频时间线归零（`a2d7c64`）；②Entry Gate 显示期间 About / Intro 的 document 级 `activate` 会抢跑夜曲（`ce051f1` 加 `entry-locked` 闸门拦事件穿透）；③NEW VISIT 的初始落点改由 `visitSession().isNew` 决定为 Home（`8dc8ded`，替代 `0fe79fa` 那次事后 `scrollTo(0)` 补丁）。
- 文件：**新增** `src/content/blog/a-nocturne-for-you.zh.md`、`src/content/blog/a-nocturne-for-you.en.md`；`DEVELOPMENT.md`（本条）。没有改任何代码 / 样式 / 配置。
- 钩子/数据：无新增 data-* / storage key / 事件；沿用既有 blog 集合 schema（`title` / `description` / `pubDate` / `lang` / `tags[]`）。
- 验证：`npm run check` 0 错误 0 警告 0 提示；`npm run build` 19 页（原 17 页 + 中英各一篇），生成 `/blog/a-nocturne-for-you/` 与 `/en/blog/a-nocturne-for-you/` 且两页互链正确。

### 2026-09-22 · 主页 MP3：刷新后自己恢复 + 第一次起播不再把开头吃掉

- 需求：本人报两件事 —— ①"在主页某些位置刷新时，背景音乐不会恢复，必须滚到音乐播放器区域才开始"；②"第一次从入场页进主页播放 MP3 时，开头/第一拍没真正播出来，像网络还没加载完 timeline 就先走了"。要求初始化/恢复不依赖播放器 UI、刷新后独立恢复保存的播放状态与进度、第一次播放从正确起点开始且不人为等待，暂停/继续与进度保存不受影响；这轮不碰 Entry Gate / visit 判定 / MIDI / scene-scroll / 关于区迟滞 / 语言系统。
- 先量后改（无头 Chrome + 真实静态服务器，`Content-Length` / `Range` 都给全；脚本 `.shots/music-probe.mjs`、`.shots/music-refresh-probe.mjs`）：
  - 进度恢复本身是好的：刷新后 48ms 就把 `el.currentTime` 落到保存的位置（8.03s）并接着放；这条路由是 `syncLive()`（`loadedmetadata` + 起播前各一次），与 UI 无关。
  - 真正"第一拍没播出来"是**音量**：元素初始 `volume = 0`，`applyVolume(true)` 要从 0 淡入 `AUDIO.fadeInMs = 2400ms`。实测 100ms 时 0.01、800ms 时 0.16、1600ms 才 0.27（目标 0.3）—— 开头那一段几乎是静音，而 timeline 已经在走。
  - "刷新后不自己恢复"的那部分：MusicManager 只有**外部**叫醒路径（关于区让位的 `play()`、用户点到播放器或任意 pointerdown / keydown / touchstart），自己不会在"文件就绪""切回标签页""从 bfcache 回来"时重试；手势清单里也没有 `wheel` / `scroll` / `touchmove` / `pointerup`。关于区那一带的"位置相关"表现是 §5.16 的让位设计（这轮明确没动）。
- 改动（只改 `src/scripts/music-manager.ts` + 文档）：
  1. `applyVolumeForStart()`：本次文档的**第一次**起播直接把音量摆到目标值（缓存的曲子立刻出声，不人为等待）；之后（暂停再继续、切回放过的曲子）保持原来的淡入。暂停/继续、进度保存、交叉淡入淡出都没动。
  2. 自己管恢复：新增 `retryIfIdle()`（"该响而没响"时重试，尊重用户暂停与关于区让位），挂在 `canplay`、`visibilitychange`、`pageshow` 上；手势兜底的输入种类放宽到 `pointerdown` / `keydown` / `touchstart` / `touchmove` / `wheel` / `scroll` / `pointerup`。
  3. 明确不动的：`music-ui.ts` 仍然只读状态、只转发点击/拖动（不会去启动音乐）；不新增任何音频实例（每首曲子还是 `elements` 里那一个 `<audio>`）。
- 文件：`src/scripts/music-manager.ts`、`DEVELOPMENT.md`（§5.5 / 本条）。没碰 Entry Gate / visit-session / MIDI / nocturne transport / scene-scroll / 关于区迟滞 / 语言系统。
- 钩子/数据：无新增 data-* / storage key / 事件。
- 验证：`npm test` 103/103；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。实测：全新访问点"进入"之后第一个采样点 `state=active vol=0.30`（改前同一时刻 0.01），位置从 0 正常推进；刷新后 48ms `currentTime` 落到保存位置并继续播放；暂停/继续与进度保存行为未变。

### 2026-09-22 · 关于 ⇄ 自我介绍 真正无缝（一台常驻播放器）+ 返回时第一帧就回到原 scrollY

- 需求：本人要求 ①About / Intro 共用**同一个持续运行的** PianoEngine + MIDI scheduler，ClientRouter 换页时 AudioContext / 播放时间 / cursor / 排程**不停不重建**，页面只 attach/detach UI，只有离开 identity/nocturne 这一族才停；不许靠调大 `HANDOVER_AHEAD` 掩盖接缝；②从自我介绍页返回首页关于区时，**第一帧就必须直接是离开时的 scrollY**，不能"先渲染顶部 → 首页音乐响一下 → 再滚回来"。同时不许破坏手机端关于区滚动修复、语言切换、入场页。
- 根因：①原来每个页面各带一套"时钟 + 排程"（`identity-player.ts` 一套、`nocturne.ts` 一套），换页只能靠"预排 0.45 秒 + pause + 下一页面接手"糊住那条缝 —— 音会重复排、位置会跳、音量要重新滑一遍，不是真无缝。②返回时的滚动位置没人管：路由换页会 `scrollTo(0,0)`，而 `/#about` 又让浏览器带着 `scroll-behavior: smooth` 动画滚到锚点，于是"先看到顶部、再滚下去"；这期间 `boot()` 里 `music.setAboutActive(false)` 还会先把首页背景音乐放出来一下。
- 改动：
  1. **新增 `src/scripts/nocturne-transport.ts`**：全站唯一的夜曲播放器（挂在 `getGlobal().nocturne`）。score / notes / cursor / 音频时钟锚点 / 排程定时器 / 位置记忆 / 音量滑行 / `setDucked` 全在它里面；对外只有 `subscribe()`（UI attach）、`start()` / `pause()` / `restart()` / `seek()` / `attachVolume()`、`stop()`。换页时**什么都不做**，所以音频时钟一秒都不停。
  2. `identity-player.ts`：删掉自己的 tick / schedule / 交接 / 淡入，改成订阅播放器快照 —— 画瀑布流、按钮、滑杆、标签物理照旧；`disposeCurrent` 只拆 UI（不再 pause、不再交棒）。`nocturne.ts` 缩成纯 UI（写 `data-nocturne-at` / `-state` / `-ready`）。
  3. `identity-audio.ts`：删掉 `HANDOVER_AHEAD` / `handOverIdentityPiano()` / `takeIdentityHandover()`（`lib/handover.ts` 与它的单测保留，但已无调用方）。
  4. **新增 `src/scripts/scene-scroll.ts`** + `app.ts`：`astro:before-swap` 里判断这次是不是"回到刚才那一页"（目标 pathname 上有我们记的落点）—— 是的话把 `#锚点` 从路由手里拿掉（位置由我们精确恢复，`#锚点` 事后用 `history.replaceState` 接回地址栏），不是的话把当前精确 `scrollY` 记下来；`astro:after-swap`（新页第一帧之前）与 boot 里各恢复一次（都用 `behavior: 'instant'`），并据恢复后的几何决定 `music.setAboutActive()` —— 上来就在关于区时不再先放一下背景音乐。
- 文件：**新增** `src/scripts/nocturne-transport.ts`、`src/scripts/scene-scroll.ts`；改 `src/scripts/identity-player.ts`、`src/scripts/nocturne.ts`、`src/scripts/identity-audio.ts`、`src/scripts/app.ts`、`src/scripts/global.ts`（`nocturne` 取代 `identityHandover`）、`DEVELOPMENT.md`（§3 / §5.14 / §6.1 / 本条）。UI、样式、入场页、语言切换、`visit-session` 都没动。
- 钩子/数据：新增 storage key `space.scene-scroll`（`{ path, y }`，取一次即清）；`getGlobal()` 上新增 `.nocturne`、去掉 `.identityHandover`；DOM 钩子无新增（`data-nocturne-at/-state/-ready`、`data-identity-*` 语义不变）。
- 验证：`npm test` 103/103；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。无头 Chrome 实测（脚本 `.shots/seamless-probe.mjs`）：首页关于区（scrollY 3111）→ 点第十个标签进自我介绍页 → 点"返回"：AudioContext 新建计数前后不变（2 → 2，没有重建）、时间线 9.88 → 11.43 → 15.08 只增不退、返回后 `data-state=playing` / `data-scene=active`、**返回后前 30 帧的最小 scrollY = 3111（= 离开时那个值，全程没有回到顶部）**。回归：手机端关于区迟滞（`scene-probe.mjs`：抖动 5 → 0 次、走远仍停）、语言切换（`langswitch-probe.mjs`：不弹入场页、visit token 不变）。

### 2026-09-21 · 三个真问题：手机滚动把夜曲抖断 / 刷新后夜曲进不了可播放状态 / 地址栏重新输入网址不算新访问

- 需求：本人报三件事，并要求"先定位实际的 race condition / lifecycle 问题，不要用 setTimeout 掩盖"。①手机滚到关于区没声、回来之后前几秒断续；②刷新之后 About MIDI 无法正常加载 / 无法进入可播放状态；③同一个标签页在地址栏重新输入网址，仍然沿用上一趟的"已进入"，入场页不再出现。另外明确：**Entry 访问状态、夜曲时间线、音频运行时三套状态不要互相污染**，夜曲进度不许被入场逻辑清掉。
- 复现方式：本会话 Codex 的浏览器插件连不上（`unsupported Codex auth method: apikey`），改用**真实 Chrome + Playwright（CDP）+ Windows UI Automation**：`cua` 不可用，地址栏那件事必须用真输入（`SetFocus` 到地址栏 → `ValuePattern.SetValue` → Enter），脚本放在 `.shots/*.mjs` / `.shots/*.ps1`（`.shots/` 已在 .gitignore 里）。
- 根因（都是先量出来再改）：
  1. **1A 抖动**：`initJourney()` 用 `entry.intersectionRatio >= 0.35` 同时管进和出，判据是"露出 ÷ 区块高度"。实测 393×852 手机上关于区高 679px，停在 0.35 边界时地址栏收起/展开（视口 852 ↔ 750）让判据在 **0.35 ↔ 0.373** 之间跳 → `data-state` 翻 5 次（pause → playing → pause → playing → pause），每次都是 `allNotesOff()` + 重新排程。这就是"第一次滚到底没声 / 回来之后前几秒断续"。
  2. **1B 生命周期**：`astro:page-load` 在**初始硬加载**上也会发（`router.js` 的 `addEventListener('load', onPageLoad)`），而 `app.ts` 还会在 DOMContentLoaded 自己 boot 一次 —— 硬加载时 boot 跑两遍（实测 `IntersectionObserver` 构造次数 = 4 = 2 次 `initJourney()`；修后 = 2）。第二遍的 `disposeJourney() → disposeIdentity()` 会把第一遍刚建好的播放器 abort 掉再重建。同一族里还有两处死路：`preload()` 开头 `if (state === 'ready') return` 让"补下漏掉的采样"成了**永不执行的死代码**（实测：给 5 个只有夜曲才用的采样注入首轮失败 → 修前 5 个**永远缺**、播放器却照样显示 ready/playing；修后 5 个全在 ~1.24s 后被补回、0 缺失）；`ensure()` 只认 `failed` 就返回，且不看 `state === 'closed'`；`nocturne.ts` 只听 `piano:state`，`resume()` 晚一点才成功时它就一直停在 waiting（实测：进入自我介绍页后 `data-nocturne-at` 一直是空）。
  3. **2 入场边界**：`entry-gate.ts` 只看 `PerformanceNavigationTiming.type`：地址栏重新输入同一个网址时，"报 `navigate` 的浏览器"能被认出来，"报 `reload` 的浏览器"会被当成刷新（本人遇到的正是后者）。而且这个判定原来还兼任两件事，站内换页时那份"新访问"的结论会在整份文档里一直有效。
- 改动：
  1. 新增 `src/lib/visit.ts`（纯逻辑：`visitBoundary()` / `navigationKind()` / `readEntryToken()` / `stampEntryToken()`，`tests/visit.test.mjs` 15 项）与 `src/scripts/visit-session.ts`（`visitSession()`：这一趟的 id、`isNew`、`hasEntered()` / `markEntered()`）。判定 = 导航类型 + **当前历史条目上我们盖的访问 id**：刷新条目原样留着（同一趟），地址栏重新输入网址则是新条目（新的一趟）。每次 boot 补盖一次章（Astro 客户端路由 push 新条目时会冲掉 state，见 §5.15 两个坑）。
  2. `entry-gate.ts`：拦人的判据改成**只问 `hasEntered()`**（新的一趟判定时已经把 `rest-note.entry-passed` 清掉）；收尾去锚点改成 `history.replaceState(history.state, …)`，不再把章和 Astro 的滚动位置一起抹掉；顺手把那段 tab 缩进的代码恢复成两空格。
  3. `identity-player.ts`：落点 cookie 名改用 `visitSession().token`（不再自己看 navigation type、也不再用 `rest-note.identity-visit`）；加 `identityGeneration` 代际守卫。
  4. `app.ts`：`booted` 闸门（一次加载一次 boot，`astro:after-swap` 放行）；`disposeJourney()` 无条件 `disposeIdentity()`；关于区的激活判定换成 `lib/scene.ts` 的覆盖度 + 迟滞（0.55 / 0.25，新增 `tests/scene.test.mjs` 7 项），并写 `data-scene` 读数。
  5. `piano.ts`：`preload()` 按"还缺不缺"判断、最多 4 轮、每轮 1.5 秒后补漏（补到东西会补发一次 `piano:state`）；`ensure()` 处理 `state === 'closed'` 的上下文与"下够轮数"的收口；`dispose()` 收掉补下定时器。
  6. `nocturne.ts`：补 `piano:context` 监听（上下文晚醒也要接上）。
- 文件：新增 `src/lib/visit.ts`、`src/lib/scene.ts`、`src/scripts/visit-session.ts`、`tests/visit.test.mjs`、`tests/scene.test.mjs`；改动 `src/scripts/app.ts`、`src/scripts/entry-gate.ts`、`src/scripts/identity-player.ts`、`src/scripts/piano.ts`、`src/scripts/nocturne.ts`、`DEVELOPMENT.md`（§3 / §5.8 / §5.11 / 新增 §5.15–§5.17 / §6.1 / §7 / 本条）。
- 函数：新增 `visitSession()`、`visitBoundary()`、`navigationKind()`、`readEntryToken()`、`stampEntryToken()`、`VISIT_STATE_KEY`、`sceneCoverage()`、`sceneDecision()`、`SCENE_ENTER` / `SCENE_LEAVE` / `SCENE_THRESHOLDS`；`initEntryGate()` 的判定改走访问会话；`initJourney()` 的观察器改迟滞判据；`boot()` 加闸门；`PianoEngine.preload()` / `ensure()` / `dispose()` 改生命周期。
- 钩子/数据：新增 `html[data-visit]`（`new` / `same`）与 `[data-journey-section="about"][data-scene]`（`active` / `idle`）两个排查读数；storage key：新增 `rest-note.visit`，`rest-note.identity-visit` 不再使用（`rest-note.entry-passed` 语义不变，只是现在由访问会话负责清）；`history.state` 上新增 `restNoteVisit` 字段（与 Astro 的 `index` / `scrollX` / `scrollY` 共存）。没有新增自定义事件。
- 验证（真实 Chrome 152，本地构建产物；脚本在 `.shots/`）：
  - `npm test` **103/103**（新增 15 + 7 项）；`npm run check` 0 错误 0 警告 0 提示；`npm run build` 17 页。
  - **1A**（`scene-probe.mjs`，393×852）：边界抖动 5 次 → **0 次**；回顶部/滚到博客区 → `scene=idle state=paused`，滚到底 → `scene=active state=playing`。
  - **1B**（`reload-probe.mjs` / `samples-probe.mjs`）：硬加载 `IntersectionObserver` 构造 4 → **2**（= 一次 boot）；播放中刷新 → `data-state=playing` 连续、时间线 8.31s → 19.09s 接着走；注入首轮失败的 5 个夜曲专用采样 → 修前**永远缺失**、修后全部在 ~1.24s 后补回（0 缺失）；刷新后暂停/恢复各一次都正常（`paused` → `playing`，之后一直 playing）。
  - **2**（`scenarios.mjs`，真实地址栏 + 真 F5 + 真新标签页）：**A–O 全过** —— 首次加载有入场页；站内换语言页不入场页；刷新（含站内换页之后刷新）不入场页；前进后退不入场页；F5 不入场页；**地址栏重新输入同一个网址 → 出现入场页**；地址栏回车（未编辑）→ 出现入场页；地址栏输入别的网址 → 出现入场页；跨文档后退 → 不入场页；新标签页 → 出现入场页；自我介绍页 → 点"返回"回到关于区，夜曲 7.30s → 11.50s 接着弹、`data-state=playing`。
  - 未能覆盖：iOS 那种"AudioContext 必须在手势里才能启动"的路径 —— 无头 Chrome 无论怎么设 `--autoplay-policy` 都会给出 running 的上下文（实测 `new AudioContext().state === 'running'`，`navigator.userActivation` 也不可用），只能在真机上确认；代码侧对应的三条兜底是入场点击里的 `primeIdentityPiano()`、`primeIdentityPianoOnFirstGesture()` 与两处 `piano:context` 监听。

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
