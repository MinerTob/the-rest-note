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
├── styles/       tokens.css（设计变量）/ global.css / home-glass.css（首页专用材质）
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
| 语言切换 + 文字滑出/滑入 | `src/scripts/lang.ts`、`src/styles/global.css`、`src/scripts/app.ts` | `initLangSwitch()`、`swapChrome()`、`collectTextElements()`、`markIncomingLanguageText()` | `[data-lang-switch]`、`html[data-lang]`、`.lang-slide-out` / `.lang-slide-in` |
| 主题切换（modern/baroque） | `src/scripts/theme.ts`、`src/scripts/theme-switch.ts`、`src/lib/themes.ts` | `ThemeManager`、`initTheme()`、`initThemeSwitcher()`、`setTheme()`、`toggle()` | `html[data-theme]`、`[data-theme-switch]` |
| 全站状态 | `src/scripts/app-state.ts` | `AppStore.get()` / `set()` / `isUnlocked()` / `hasUnlocks()` | `'change'` 事件（detail: `{ state, previous }`） |
| LCD 时钟 | `src/components/LcdClock.astro`、`src/scripts/clock.ts` | `initClock()` | `[data-clock]`、`[data-clock-time]`、`[data-clock-date]` |
| 背景音乐播放器 | `src/components/MusicSystem.astro`、`src/scripts/music-manager.ts`、`music-ui.ts`、`src/lib/music.ts` | `MusicManager`、`initMusicUI()` | `[data-music]`、`[data-music-toggle/-progress/-volume/-state/-title/-subtitle/-time]` |
| 播放进度记忆 | `src/lib/live-timeline.ts` | `savedPosition()` / `savePosition()` / `restartPosition()` | sessionStorage `space.position.v1.<id>` |
| MiniLab 25 键 | `src/components/MiniLab.astro`、`src/scripts/minilab.ts`、`notes.ts` | `initMiniLab()`、`MiniLabController` | `[data-minilab*]`、`[data-midi]`、`data-word-*` |
| 钢琴采样引擎 | `src/scripts/piano.ts`、`src/lib/piano.ts` | `PianoEngine`、`nearestSample()`、`playbackRateFor()`、`samplesForRange()` | 事件 `piano:state` / `piano:context` / `piano:progress` |
| 合成器（无采样兜底） | `src/scripts/synth.ts` | `KeysSynth.unlock()` / `noteOn()` / `noteOff()` / `allNotesOff()` | — |
| 真实 MIDI 键盘 | `src/scripts/midi.ts` | `MidiBridge`、`getMidiBridge()` | 事件 `midi:noteon` / `midi:noteoff` / `midi:change` |
| 彩蛋（隐藏曲目） | `src/lib/easter-eggs.ts`、`src/lib/sequences.ts`、`src/scripts/easter-eggs.ts` | `EASTER_EGGS`、`createSequenceDetector()`、`createSequenceSession()`、`EasterEggManager` | `[data-note]`（琴键）、事件 `minilab:note` / `egg:hint` / `egg:accept` / `egg:miss` |
| About 身份实验场 | `src/components/IdentityStage.astro`、`src/scripts/identity-player.ts`、`identity-physics.ts`、`src/lib/identity.ts`、`identity-midi.ts` | `createIdentityPhysics()`、`initIdentity()`、`disposeIdentity()`、`setIdentityActive()`、`identityRevealPlan()` | `[data-identity*]` |
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
// 内部：
collectTextElements(root)      // TreeWalker 收集"承载文字的元素"，祖先命中则跳过后代
playOut(elements) / playIn(elements)
switchChromeInPlace(target)    // 两种语言共用同一地址时（如 404）的兜底
```

**点击一条语言链接的完整链路**：

```
click [data-lang-switch]
  → writeString('space.lang', target)
  → collectTextElements(document) 收集全部文字元素
  → playOut()：加 .lang-slide-out（240ms 向左滑出 + 淡出；pointer-events:none）
  → 等 SLIDE_MS
  → sessionStorage['space.lang-transition'] = '1'
  → navigate(href)（Astro 客户端导航，不刷新浏览器）
     ↳ astro:before-swap 钩子里 markIncomingLanguageText(newDocument)：
         给新文档的文字加 .lang-slide-in，并去掉 .rise（跳过入场动画）
     ↳ 新页面插入第一帧就开始"从右滑入"
  → boot() → playIncomingTransition()：清标记，动画结束后摘掉类名
  → finally：兜底摘掉 .lang-slide-out（导航失败时文字能恢复）
```

- 动画时长 `SLIDE_MS = 240`，与 CSS 里的 `var(--dur-2)` 保持一致（改一个要改两处）。
- 跳过 `.ambient` / `.entry-gate` / `script` / `style` 等节点；`svg` 子树不动。
- 元素原本的透明度（少数弱化文字不是 1）会记在 `--lang-opacity` 里，动画结束回到原值。
- 系统开启 *减少动态效果*（`prefers-reduced-motion: reduce`）时：完全跳过动画和等待，直接切换。
- 语言偏好存 localStorage `space.lang`；进站时若偏好与页面语言不同，只换 UI 文案（正文语言仍由 URL 决定）。

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
  toggleHint(): void;    // Shift+P：进入 / 退出提示模式
  disarm(): void;
  note(note: string): void;   // 唯一的音符入口
}
function initEasterEggs(store: AppStore, theme: ThemeManager): void;
```

**三条铁律（写在 `lib/easter-eggs.ts` 注释里）**：

1. 彩蛋内容绝不出现在页面上，也不给访客文字答案。
2. 每条彩蛋只属于一个主题：提示模式按"当前主题"挑序列（modern 里没有返回序列，反之亦然）。
3. 提示模式一次只亮一个键，不显示完整序列 / 进度数字 / "下一个音"。

**一次完整触发**：

```
MiniLab 弹下某个键
  → window 'minilab:note' { midi, note, velocity, source }
     → EasterEggManager.note(note)
        → 不在提示模式 → 直接返回（不比对、不记录）
        → 在提示模式：SequenceSession.push()
             命中 → trigger()：解锁曲目写入 store + theme.setTheme(resultTheme)
                               + 'space:message' 系统提示 + 'egg:hint' 收尾
             按对 → window 'egg:accept'（琴键先 ACCEPTED，再亮下一个）
             按错 → window 'egg:miss'（当前提示轻闪一下，不清空重来）
```

- 管理器是 `getGlobal().eggs` 单例：**客户端路由换页后进度不丢**。
- `initEasterEggs` 里有一个 `global.eggsBound` 守卫，避免重复绑定 `minilab:note` 与 Shift+P。
- **加一条新彩蛋 = 往 `EASTER_EGGS` 数组加一条**，不用改 MiniLab、不用改管理器（测试会校验它是否能在 25 键上弹出来）。

### 5.8 About：身份实验场

**文件**：`src/components/IdentityStage.astro`、`src/scripts/identity-player.ts`、`src/scripts/identity-physics.ts`、`src/lib/identity.ts`、`src/lib/identity-midi.ts`

```ts
// identity-player.ts
initIdentity(): void;          // 页面存在 [data-identity] 才初始化
disposeIdentity(): void;       // 注销（换页 / 离开 About 区时）
setIdentityActive(active: boolean): void;  // 进入/离开视口时激活

// identity-physics.ts（matter-js）
createIdentityPhysics(root: HTMLElement, tags: HTMLElement[], onSettled?, onActivate?): { dispose? }

// lib/identity.ts
IDENTITY_TAGS / IDENTITY_TAG_IDS / tagLabel(tag, lang) / tagById(id)
IDENTITY_MOTION   // 弹出→飞行→落地→停稳 的时序常量
IDENTITY_TRACK_SRC // 驱动这个体验的 MIDI 文件（public/music/secret/...）

// lib/identity-midi.ts
parseMidi(bytes: Uint8Array): MidiScore;
identityRevealPlan(score, count): 每个标签的揭示时刻（并校验曲子的弱起结构）
```

- 标签的入场不是 `scale(0)→scale(1)`，而是被"弹出来"的物理动画：ejection → flight（浅抛物线 + 轻微旋转）→ landing → settle。动画参数在 `IDENTITY_MOTION`。
- 布局（标签落点）会存 cookie：`readLayout()` / `writeLayout()` / `clearLayout()`（内部函数）。
- **第十个标签（`intro`）是唯一的例外**：它比别的标签大 0.2 倍，点一下进整页自我介绍（§5.14）。放大用的是 font-size / padding 同比例放大（`calc(基准 * 1.2)`），**不能用 `transform: scale()`** —— 物理引擎每帧都会重写 inline `transform`。
- 点按判定在 `identity-physics.ts`：按下后位移 < 8px、且 0.7s 内抬手才算"点击"；拖动过就不算（"抛掷"不能被误认成"点开"）。命中 + 元素带 `data-identity-link` 才回调 `onActivate`，由 `identity-player.ts` 走 `astro:transitions/client` 的 `navigate()`（失败退回 `location.assign`）；键盘上按回车同样打开。
- `reveal()` 算"备用队形"（没接住音符时靠地面排队）的间距时只统计普通标签：可点击的那个宽得多，算进去会把整排挤成单列。
- 首页 Journey 模式里，`initJourney()` 用 IntersectionObserver 在滚到 About 区时调用 `initIdentity()` / `setIdentityActive(true)`（见 `src/scripts/app.ts`）。
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

**文件**：`src/components/EntryGate.astro`、`src/scripts/entry-gate.ts`、`src/scripts/app.ts`

```ts
initEntryGate(music: MusicManager): boolean;   // true = 正在拦着（页面被锁）
```

- 只在"地址栏输入 / 书签 / 外链"（navigation type = `navigate`）时要求重新入场；`reload` / `back_forward` 沿用 sessionStorage `rest-note.entry-passed`。
- 进入方式：点击 `[data-entry-button]`。这个 click 处理器里**必须直接调用** `music.play()`（浏览器自动播放策略要求音频解锁发生在可信手势里，见代码注释）。
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
| `src/styles/tokens.css` | 全部设计变量：字体/字号/行高、圆角、缓动与时长、布局栅格、模糊、纸张与墨色、accent/glow、玻璃、LCD、控件、渐变（`--grad-*`）。`[data-theme='baroque']` 里是第二套值；文件底部有 reduced-motion 覆盖（时长压到 1ms） |
| `src/styles/global.css` | 站点基础：Reset / Ambient 背景 / Layout / Typography / Glass 系统（`.glass--1..4`）/ LCD 系统（`.lcd`）/ 状态灯 / Controls / 页面入场（`.rise`）/ **语言切换文字动画（`.lang-slide-out` / `.lang-slide-in`）** / 主题过渡（`.theme-shift`）/ 无障碍 / Prose |
| `src/styles/home-glass.css` | 只在首页使用的材质覆盖（被 `HomePage.astro` import，其他路由不受影响） |

规则：

- 组件里**只允许用语义 token**（`--ink`、`--glass-2`、`--accent`…），不写死颜色；否则换主题一定掉队。
- 玻璃卡片用 `.glass` + `.glass--N`；LCD 面用 `.lcd`。
- 页面入场动画是 `.rise` / `.rise--2/3/4`（一次性 CSS animation）。**语言切换进新页面时会被有意去掉**（见 §5.4），因为那一次只该动文字。
- 所有动画都要在 `@media (prefers-reduced-motion: no-preference)` 里，或自己判断 reduced motion。

### 5.14 自我介绍页（About 第十个标签的去处）

**文件**：`src/views/IntroPage.astro`、`src/pages/about/intro/index.astro`、`src/pages/en/about/intro/index.astro`、`src/content/pages/intro.zh.md`、`src/content/pages/intro.en.md`、`src/scripts/nocturne.ts`

- 路由常量：`src/lib/pages.ts` 的 `introRoutes = { zh: '/about/intro/', en: '/en/about/intro/' }`；About 页第十个标签的 `href` 就是它。
- 正文是内容集合 `pages` 里的 Markdown，视图里 `getPage('intro', lang)` + `render(entry)`；文案只有本人原文（中文）和对应英文翻译，**不要在这里补写没确认过的自我介绍**。
- **本人标了分段的地方 = Markdown 的 `##`**：`.letter :global(h2)` 只负责"加大加粗"（`clamp(1.55rem … 2.05rem)` + `font-weight: 700`）。本人后来要求把标题上方那道"⸻ 短线"删掉，**不要再加回任何装饰线**。改标题层级时别把 `.prose h2` 的默认样式当回事，这里是有意覆盖的。
- 头图来自 `src/images/Gensokyo.png`，用 `astro:assets` 的 `<Image>`（自动出 webp + srcset，2.6MB → 33/70/142/273kB 四档）。`src/images/` 的图不要手写 `<img>`，也不要拷进 `public/`。
- 阅读栏宽度与文章页一致：`max-width: calc(var(--measure) + var(--gutter) * 2)`；正文用 `.prose` 纸面，页脚一个"回到关于"链接。
- **左上角有一个返回按钮**（`返回关于` / `Back to About`，`.letter-page__back`，用 `.glass--pill` 材质）：这一页是从 About 的标签点进来的，得能原路回去；它和页脚那个链接都指向 `aboutRoutes[lang]`。
- **背景音乐：这一页接着放 About 页的夜曲**（不放主题曲）。`src/scripts/nocturne.ts` 用 `PianoEngine` + `parseMidi()` 复刻 About 的演奏，和 `identity-player.ts` 共用 `live-timeline` 的同一个 id（`identity:nocturne`），两边互相"接着放"，不是各弹各的；音量用 `IDENTITY_INTRO_VOLUME`（0.7，比演奏模式的 0.85 克制），淡入用 `AUDIO.fadeInMs`。
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
| `space.position.v1.<id>` | sessionStorage | 每首曲子记下"暂停时的位置" | `src/lib/live-timeline.ts` |
| `rest-note.entry-passed` | sessionStorage | 本次会话已通过入场页 | `src/scripts/entry-gate.ts` |

规则：所有读写都走 `src/scripts/storage.ts` 的封装（`readString` / `writeString` / `readNumber` / `readBool` / `writeNumber` / `writeBool`），隐私模式下静默降级，不抛异常。跨设备/长期偏好放 localStorage，一次性、会话内的放 sessionStorage。

### 6.2 自定义事件总表

| 事件 | 目标 | detail | 谁派发 | 谁监听 |
| --- | --- | --- | --- | --- |
| `change` | `AppStore` | `{ state, previous }` | `app-state.ts` | `theme.ts`、其它 UI |
| `change` | `MusicManager` | — | `music-manager.ts` | `music-ui.ts` |
| `space:message` | window | `{ message, detail? }` | 彩蛋 / 联系复制 / 任意模块 | `system-message.ts`（LCD 提示） |
| `minilab:note` | window | `{ midi, note, velocity, source }` | `minilab.ts` | `easter-eggs.ts` |
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
| `[data-identity-link]` | `IdentityStage.astro`（第十个标签的 href） | `identity-physics.ts`（点按判定 + 回车）、`identity-player.ts`（`navigate()`） | 可点击标签：放大 1.2× + 点开自我介绍页；有它就参与"点击"逻辑 |
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

### 2026-09-19 · About 第十个标签「自我介绍」+ 整页长文（中英）+ 这一页续播夜曲

- 需求：1) About 的身份标签从九个加到十个 —— 第十个要在"弱起 + 前四小节"里放出来，尺寸比别的标签大一点（本人先要 0.5 倍，看到实物后改成 0.2 倍），文案"自我介绍（听了这么久，点一点我吧，求求了(｡>﹏<｡)）"，点开进一个全新的页面；2) 新页面是一整页自我介绍长文（本人原文 + 英文翻译），本人标了分段的地方标题要加大加粗，并插入 `src/images/` 里的图；3) 标签文案太长 → 排成两行；标题上方的"⸻ 短线"要删掉；4) 这一页要接着放 About 的夜曲（不是按主题播背景音乐），左上角加一个返回按钮。
- 文件：`src/lib/identity.ts`（第十个标签、`tagLines()`、`IDENTITY_INTRO_VOLUME`）、`src/lib/pages.ts`（`introRoutes`）、`src/components/IdentityStage.astro`（渲染成 `<a>` + 两行文案 + 1.2× 样式 + 专属 glyph/颜色）、`src/scripts/identity-physics.ts`（点按判定、大标签不自转、队形间距）、`src/scripts/identity-player.ts`（`navigate()`）、`src/scripts/nocturne.ts`（**新增**：这一页的背景演奏）、`src/scripts/app.ts`（boot / before-swap / `setAboutActive`）、`src/styles/tokens.css`（`--identity-intro` 两套主题）、**新增** `src/views/IntroPage.astro`、`src/pages/about/intro/index.astro`、`src/pages/en/about/intro/index.astro`、`src/content/pages/intro.zh.md`、`src/content/pages/intro.en.md`、`tests/identity.test.mjs`、`tests/identity-midi.test.mjs`。
- 函数：`tagLines(tag, lang)`（把"自我介绍（…）"拆成标题行 + 括号行）、`createIdentityPhysics(root, tags, onSettled, onActivate)`（新增第四个参数：点按回调）、`initNocturne()` / `disposeNocturne()`、`getPage('intro', lang)`、`render(entry)`、`introRoutes`、`IDENTITY_INTRO_VOLUME`。
- 钩子/数据：新增 `[data-identity-link]`（第十个标签的 href：放大 + 可点开，参与点按判定）、`[data-nocturne]`（自我介绍页根节点）、`[data-nocturne-ready]` / `[data-nocturne-state]` / `[data-nocturne-at]`；没有新 storage key（夜曲与 About 共用时间线 `space.position.v1.identity:nocturne`）；旧落点 cookie 长度对不上会自动重播一次，属预期。
- 验证：`npm test` 69/69（新增"十个标签""十个揭示时刻都落在弱起+前四小节内""文案拆两行""夜曲音量"四条断言）；`npm run check` 0 错误 0 警告；`npm run build` 17 页、头图出 4 档 webp（2.6MB → 33/70/142/273kB）。浏览器实测（本地 preview，639px 视口）：`/about/` 10 个标签、第十个 18px/353×76（其余 15px/106×46 = 1.2×）、两行文案、"点一下"跳 `/about/intro/`、拖动 90px 不误跳（URL 仍是 `/about/`）；自我介绍页 h1 34.5px、15 个 `##` 标题 28.1px/700 且 `::before` 为 none（短线已删）、头图 588×331 webp、左上角"← 返回关于"指向 `/about/`；夜曲 `data-nocturne-state=playing`，`data-nocturne-at` 从 About 页的进度接着走（点击时约 2:1x，进入新页后继续累加，没有从 0 重来）。

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
11. **第十个标签（自我介绍）**：它比别的标签大 0.2 倍 —— 放大只能改 font-size / padding（写成 `calc(基准 * 1.2)`），写 `transform: scale()` 会被物理引擎每帧覆盖；"点开"的判定在 `identity-physics.ts`（位移 < 8px 且 0.7s 内抬手），拖动抛掷不会误触发跳转。要改尺寸就改 `IdentityStage.astro` 里 `[data-identity-link]` 那组规则；要改文案就改 `src/lib/identity.ts` 的最后一个条目。

---

*文档最后更新：2026-09-19。新增功能记得更新 §10。*
