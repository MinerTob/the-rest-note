/**
 * 极薄 Node Web Service 网关（**不是 Astro SSR**）
 * ------------------------------------------------------------------
 * Astro 照旧 `npm run build` 出 `dist/` 静态文件；这个进程只做四件事：
 *   1. HTTP 入口判断（谁在请求、要的是不是站内 HTML 页面）；
 *   2. 中英文 NEW VISIT 入口重定向（未进门时的子路由 → 本语言首页）；
 *   3. Entry Gate 的服务端 session cookie（`rest_note_visit` / `rest_note_entered`）；
 *   4. 从 `dist/` 分发静态文件（HTML / `_astro/*` / 图片 / CSS / JS / sitemap / RSS / ...）。
 *
 * **前端逻辑一律不上服务器**：MIDI、AudioContext、scene、scroll、SPA 换页、Entry Gate 的
 * 动画与音频解锁都还在浏览器里（见 DEVELOPMENT.md §5.15 / §5.11）。
 * 服务端只认真实 HTTP 入口 —— #fragment 不会发过来，所以首页那四个 Journey hash
 * 仍然由 `BaseHead.astro` 的早期脚本在客户端兜底。
 *
 * 生产启动（package.json 的 `start:server`）：
 *   node --experimental-strip-types server/index.ts
 * Node 直接跑 TypeScript（只剥类型，不做转换），所以这里不用任何构建步骤、也没有框架依赖。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTER_PATH, decideEntry, isHtmlPagePath } from './entry-router.ts';
import {
  enteredCookie,
  isSecureRequest,
  newVisitToken,
  readEntryCookies,
  visitCookie,
} from './visit-cookie.ts';

/** dist/ 的绝对路径（本文件在 server/ 下） */
const DIST_ROOT = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
/** Render 会给出 PORT；本地默认 3000。必须监听 0.0.0.0 才能被平台代理到。 */
const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
const HOST = '0.0.0.0';

/** Render 健康检查的 path（render.yaml 的 healthCheckPath）；**不碰** cookie / Entry Gate / dist */
const HEALTH_PATH = '/health';
/** 健康检查的 body：固定 `ok` */
const HEALTH_BODY = 'ok';

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * URL → pathname（解码一次，后面的判定与文件查找都用它）。
 * 拿不到合法 URL / 解码失败就返回 null（上层回 400）。
 */
function readPathname(rawUrl: string | undefined): string | null {
  try {
    return decodeURIComponent(new URL(rawUrl ?? '/', 'http://localhost').pathname);
  } catch {
    return null;
  }
}

/**
 * pathname → dist/ 内的绝对路径。**防 path traversal**：
 * `path.resolve` 先把 `..` 规范化，再要求结果落在 DIST_ROOT 里（或就是它自己）。
 * 所以 `/../../etc/passwd`、`/%2e%2e%2f%2e%2e%2fsecret`、`/a/..\..\b` 都会被拒。
 */
function resolveInsideDist(pathname: string): string | null {
  if (pathname.includes('\0')) return null;
  const relative = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const candidate = resolve(DIST_ROOT, `.${relative}`);
  if (candidate !== DIST_ROOT && !candidate.startsWith(DIST_ROOT + sep)) return null;
  return candidate;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** 目录 → `index.html`；`/about` 这种省略后缀的写法也允许（dist 里是 `about/index.html`） */
async function resolveStaticFile(pathname: string): Promise<string | null> {
  const base = resolveInsideDist(pathname);
  if (!base) return null;
  if (await isFile(base)) return base;
  const index = join(base, 'index.html');
  if (await isFile(index)) return index;
  if (extname(base) === '') {
    const html = `${base}.html`;
    if (await isFile(html)) return html;
  }
  return null;
}

/** 只有需要写回的 cookie 才带 Set-Cookie（可能是两条，所以要给数组） */
function cookieHeaders(cookies: string[]): Record<string, string | string[]> {
  return cookies.length > 0 ? { 'Set-Cookie': cookies } : {};
}

/**
 * HTML 一律 `no-cache`：入口判定依赖 cookie，浏览器缓存住子页 HTML 就等于绕过网关。
 * `_astro/` 里是带 hash 的构建产物，可以永久缓存。
 */
function cacheControl(pathname: string, isHtml: boolean): string {
  if (isHtml) return 'no-cache';
  if (pathname.startsWith('/_astro/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

/** 取一个请求头（同名多值时取第一个；没有就是 undefined） */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 解析 `Range` 请求头里的**单一** bytes 段（媒体文件播放要靠它：浏览器先探一段、
 * 拖动进度条时再要某一段，没有它就只能整份下载）。
 *
 *   · `bytes=start-end`  闭区间（end 超出文件末尾就夹到末尾）
 *   · `bytes=start-`     从 start 到文件末尾
 *   · `bytes=-suffix`    最后 suffix 个字节
 *   · 合法 → `{ start, end }`（含两端）
 *   · 没有 Range / 不是 bytes 单位 / 语法不认识 / **multi-range 带逗号** → `null`
 *     （调用方按"整文件 200"处理：本轮不支持多段，保持简单稳定）
 *   · 有 Range 但一个字节都给不出（起点 ≥ 文件长度、end < start、suffix ≤ 0）→ `'unsatisfiable'`
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const unit = /^bytes=(.+)$/i.exec(header.trim());
  if (!unit) return null;
  const spec = unit[1].trim();
  if (spec.includes(',')) return null;
  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return null;
  const [, rawStart, rawEnd] = parts;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // bytes=-N：最后 N 个字节
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix)) return null;
    if (suffix <= 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return 'unsatisfiable';
  if (rawEnd === '') return { start, end: size - 1 };

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end)) return null;
  if (end < start) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

/**
 * 把文件（或其中一段）用流写出去，**不整份读进内存** —— MP3 有 4–5MB，
 * 先把整个文件 `readFile` 再切片就等于没做 Range。
 */
async function sendFile(
  res: ServerResponse,
  file: string,
  range?: { start: number; end: number },
): Promise<void> {
  const stream = range
    ? createReadStream(file, { start: range.start, end: range.end })
    : createReadStream(file);
  try {
    await pipeline(stream, res);
  } catch {
    // 客户端中途断了 / 读文件出错：响应头已经发出去了，没法再改成 404，直接断开
    res.destroy();
  }
}

async function serveNotFound(
  res: ServerResponse,
  head: boolean,
  cookies: string[],
): Promise<void> {
  const fallback = join(DIST_ROOT, '404.html');
  const hasFallback = await isFile(fallback);
  const body = hasFallback
    ? await readFile(fallback)
    : Buffer.from('404 Not Found\n', 'utf8');
  res.writeHead(404, {
    'Content-Type': hasFallback ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'Content-Length': String(body.byteLength),
    'Cache-Control': 'no-cache',
    ...cookieHeaders(cookies),
  });
  if (head) {
    res.end();
    return;
  }
  res.end(body);
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  head: boolean,
  cookies: string[],
): Promise<void> {
  const file = await resolveStaticFile(pathname);
  if (!file) {
    await serveNotFound(res, head, cookies);
    return;
  }

  // 先拿文件大小：Range 的解析、206 的 Content-Range、200 的 Content-Length 都要它
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    await serveNotFound(res, head, cookies);
    return;
  }

  const isHtml = file.toLowerCase().endsWith('.html');
  /*
   * 静态文件一律声明 `Accept-Ranges: bytes`（媒体播放器据此决定能不能按段要数据）。
   * 缓存策略保持原样：HTML = no-cache（+ Vary: Cookie）、_astro/ = immutable、其余 max-age。
   */
  const headers: Record<string, string | string[]> = {
    'Content-Type': contentType(file),
    'Cache-Control': cacheControl(pathname, isHtml),
    'Accept-Ranges': 'bytes',
    // 同一份 HTML 会因为 cookie 不同而拿到 302 或 200，共享缓存必须按 Cookie 分开
    ...(isHtml ? { Vary: 'Cookie' } : {}),
    ...cookieHeaders(cookies),
  };

  const range = parseRange(headerValue(req, 'range'), size);

  // 有 Range 但一个字节都给不出：416 + `bytes */总长`（HEAD 同样只回头）
  if (range === 'unsatisfiable') {
    res.writeHead(416, {
      ...headers,
      'Content-Range': `bytes */${size}`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  // 206 Partial Content：只发要的那一段（start / end 都已按文件大小夹好）
  if (range) {
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': String(range.end - range.start + 1),
    });
    if (head) {
      res.end();
      return;
    }
    await sendFile(res, file, range);
    return;
  }

  // 没有（或不认识）Range：整文件 200，行为与以前一致
  res.writeHead(200, {
    ...headers,
    'Content-Length': String(size),
  });
  if (head) {
    res.end();
    return;
  }
  await sendFile(res, file);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const head = method === 'HEAD';
  const pathname = readPathname(req.url);
  if (pathname === null) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('400 Bad Request\n');
    return;
  }

  /*
   * Render 健康检查：**放在最前面** —— 在读 cookie、进 Entry Gate 判定、碰 dist 之前就返回。
   * 所以它不读也不写任何 cookie（rest_note_visit / rest_note_entered 都不会被创建）、
   * 不参与 302、不读磁盘、不改任何访问状态：GET/HEAD 之外的方法给 405。
   */
  if (pathname === HEALTH_PATH) {
    if (method === 'GET' || method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': String(HEALTH_BODY.length),
        'Cache-Control': 'no-store',
      });
      if (head) {
        res.end();
        return;
      }
      res.end(HEALTH_BODY);
      return;
    }
    res.writeHead(405, {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end('405 Method Not Allowed\n');
    return;
  }

  const secure = isSecureRequest(req);
  const cookies = readEntryCookies(req.headers.cookie);
  const decision = decideEntry({ method, pathname, entered: cookies.entered });

  /*
   * 服务端访问 id：HTML 页面与 /api/enter 上补发，静态资源不掺和（省掉每条资源一个 Set-Cookie）。
   * 值只有随机 token，HttpOnly，session 级（浏览器会话结束就没了）—— 见 visit-cookie.ts。
   */
  const setCookies: string[] = [];
  if (!cookies.visit && (isHtmlPagePath(pathname) || pathname === ENTER_PATH)) {
    setCookies.push(visitCookie(newVisitToken(), secure));
  }

  switch (decision.kind) {
    case 'enter': {
      // 点过"进入空间"：把这一趟服务端 session 标成已进门，204 不回页面
      setCookies.push(enteredCookie(secure));
      res.writeHead(204, { 'Cache-Control': 'no-store', ...cookieHeaders(setCookies) });
      res.end();
      return;
    }
    case 'method-not-allowed': {
      res.writeHead(405, {
        Allow: 'POST',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cookieHeaders(setCookies),
      });
      res.end('405 Method Not Allowed\n');
      return;
    }
    case 'redirect': {
      // 未进门就要子页面：回本语言首页。不带 query、不记原路由（用户点了"进入"就停在首页）
      res.writeHead(302, {
        Location: decision.location,
        'Cache-Control': 'no-store',
        ...cookieHeaders(setCookies),
      });
      res.end();
      return;
    }
    case 'static':
      break;
  }

  await serveStatic(req, res, pathname, head, setCookies);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    console.error('[gateway] request failed:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    res.end('500 Internal Server Error\n');
  });
});

if (!(await isFile(join(DIST_ROOT, 'index.html')))) {
  console.warn(`[gateway] dist/ 里没有 index.html —— 先跑 npm run build（DIST_ROOT=${DIST_ROOT}）`);
}

server.listen(PORT, HOST, () => {
  console.log(`[gateway] listening on http://${HOST}:${PORT}（dist: ${DIST_ROOT}）`);
});

/** Render 停实例时发 SIGTERM：不再接新连接，安安静静退出 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[gateway] ${signal} received, closing`);
    server.close(() => process.exit(0));
  });
}
