/**
 * 入口网关的判定逻辑（纯函数：不碰 fs、不碰 res、不认识 Entry Gate 的实现细节）
 * ------------------------------------------------------------------
 * 这一层只回答三件事：
 *   1. 这个请求是不是"站内 HTML 页面"（静态资源不是 —— 它们永远不许被重定向）；
 *   2. 这个 pathname 属于哪一版的语言首页（中文 `/` / 英文 `/en/`）；
 *   3. 这个请求该走哪条路：交给静态分发、302 回本语言首页、还是 `POST /api/enter`。
 *
 * 语言判断与客户端 `BaseHead.astro` 用的是同一条规矩：**看 pathname 的第一个非空 segment**
 * 是不是 `en`。所以 `/en`（无尾斜杠）、`/en/`、`/en/blog/...`、`/en/about/intro/...`
 * 全是英文 → `/en/`；`/`、`/blog/...`、`/about/...` 全是中文 → `/`。
 * 不要退回 `pathname === '/en/' || startsWith('/en/')`：`/en` 两条都不成立。
 */

/** `POST /api/enter`：浏览器那边点完"进入空间"来盖服务端 session 的章 */
export const ENTER_PATH = '/api/enter';

/**
 * 静态资源后缀：这些一律不走 Entry Gate（也就永远不会被 302 到首页）。
 * `_astro/` 前缀另外单独判 —— 里面全是带 hash 的构建产物。
 */
const STATIC_FILE_RE =
  /\.(?:avif|bmp|css|gif|ico|jpe?g|js|json|map|mjs|mid|midi|mp3|mp4|ogg|otf|pdf|png|svg|ttf|txt|wav|webm|webmanifest|webp|woff2?|xml)$/i;

/** 这一版的语言首页：英文（第一段是 `en`）→ `/en/`，其余 → `/` */
export function languageHome(pathname: string): '/' | '/en/' {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'en' ? '/en/' : '/';
}

/** 这个 pathname 是不是"站内 HTML 页面"（`/_astro/`、`/api/`、带静态后缀的一律不是） */
export function isHtmlPagePath(pathname: string): boolean {
  if (pathname.startsWith('/_astro/')) return false;
  if (pathname.startsWith('/api/')) return false;
  return !STATIC_FILE_RE.test(pathname);
}

/** pathname 是不是两个语言首页之一（含 `/en` 这种无尾斜杠写法） */
export function isLanguageHomePath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'en' ? parts.length === 1 : parts.length === 0;
}

export type EntryDecision =
  /** `POST /api/enter`：盖 `rest_note_entered=1` 然后 204 */
  | { kind: 'enter' }
  /** `/api/enter` 用了别的方法 */
  | { kind: 'method-not-allowed' }
  /** 还没进门、又直接要子页面：回本语言首页（不记原路由） */
  | { kind: 'redirect'; location: '/' | '/en/' }
  /** 正常交给 dist/ 静态分发 */
  | { kind: 'static' };

/**
 * 未进门时的 HTTP 入口规则：
 *   · 静态资源 → 永远放行（`/_astro/...` 不会被重定向到首页）；
 *   · 已经进门（`rest_note_entered === '1'`）→ 一律放行，站内怎么走都行；
 *   · 还没进门、请求的又是首页 → 放行，让 Entry Gate 显示；
 *   · 还没进门、请求的是子页面 → 302 到本语言首页（**不保存原路由、不带 query**）。
 */
export function decideEntry(input: {
  method: string;
  pathname: string;
  entered: boolean;
}): EntryDecision {
  if (input.pathname === ENTER_PATH) {
    return input.method === 'POST' ? { kind: 'enter' } : { kind: 'method-not-allowed' };
  }
  if (!isHtmlPagePath(input.pathname)) return { kind: 'static' };
  if (input.entered) return { kind: 'static' };
  const home = languageHome(input.pathname);
  if (isLanguageHomePath(input.pathname)) return { kind: 'static' };
  return { kind: 'redirect', location: home };
}
