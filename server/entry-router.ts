/**
 * 入口网关的判定逻辑（纯函数：不碰 fs、不碰 res、不认识 Entry Gate 的实现细节）
 * ------------------------------------------------------------------
 * 这一层只回答三件事：
 *   1. 这个请求是不是"站内 HTML 页面"（静态资源不是 —— 它们永远不许被重定向）；
 *   2. 这个 pathname 属于哪一版的语言首页（中文 `/` / 英文 `/en/`）；
 *   3. 这个请求该走哪条路：交给静态分发，还是处理 `POST /api/enter`。
 *
 * 语言判断与客户端 `BaseHead.astro` 用的是同一条规矩：**看 pathname 的第一个非空 segment**
 * 是不是 `en`。所以 `/en`（无尾斜杠）、`/en/`、`/en/blog/...`、`/en/about/intro/...`
 * 全是英文 → `/en/`；`/`、`/blog/...`、`/about/...` 全是中文 → `/`。
 * 不要退回 `pathname === '/en/' || startsWith('/en/')`：`/en` 两条都不成立。
 */

/** `POST /api/enter`：浏览器那边点完"进入空间"来盖服务端 session 的章 */
export const ENTER_PATH = '/api/enter';

/**
 * 静态资源后缀：这些不属于站内 HTML 页面。
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
  /** 正常交给 dist/ 静态分发 */
  | { kind: 'static' };

/**
 * 所有页面都正常分发。HTTP 请求头和服务端入场 cookie 无法可靠区分地址栏输入与刷新；
 * NEW VISIT 子页归首页由浏览器 <head> 脚本依据导航类型与历史条目访问章处理。
 */
export function decideEntry(input: {
  method: string;
  pathname: string;
}): EntryDecision {
  if (input.pathname === ENTER_PATH) {
    return input.method === 'POST' ? { kind: 'enter' } : { kind: 'method-not-allowed' };
  }
  return { kind: 'static' };
}
