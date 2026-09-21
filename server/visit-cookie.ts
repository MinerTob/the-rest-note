/**
 * 入口网关的两个 cookie（**只放随机 token 与 `1`，不放任何敏感信息**）
 * ------------------------------------------------------------------
 *   rest_note_visit    这一趟访问的服务端 id（随机生成，HttpOnly）
 *   rest_note_entered  这个服务端 session 有没有通过 Entry Gate（HttpOnly，值只有 `1`）
 *
 * 两者都是 **session cookie**（不写 Max-Age / Expires）：浏览器会话结束就没了 ——
 * 这正是客户端 visit-session 的"这一趟访问"语义（那边用 sessionStorage）。
 *
 * 共用属性：`HttpOnly; SameSite=Lax; Path=/`；请求是 HTTPS 时再加 `Secure`
 * （Render 在代理后面终止 TLS，所以先看 `x-forwarded-proto`，再退回 socket 自己的标记）。
 *
 * 这里不做服务端 session 存储：两个 cookie 本身就是全部状态，网关因此是无状态的。
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const VISIT_COOKIE = 'rest_note_visit';
export const ENTERED_COOKIE = 'rest_note_entered';

export type EntryCookies = {
  /** 服务端访问 id；没带就是 null（网关会补发一个） */
  visit: string | null;
  /** 这个 session 已经通过 Entry Gate */
  entered: boolean;
};

/** 解析 Cookie 头（只认我们这两个 key，其它一律忽略；值两边的引号去掉） */
function parseCookieHeader(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    let value = part.slice(index + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    jar.set(name, value);
  }
  return jar;
}

export function readEntryCookies(header: string | undefined): EntryCookies {
  const jar = parseCookieHeader(header);
  const visit = jar.get(VISIT_COOKIE);
  return {
    visit: visit && visit.length > 0 ? visit : null,
    entered: jar.get(ENTERED_COOKIE) === '1',
  };
}

/** 新的服务端访问 id：24 字节随机数，base64url 后是 cookie 安全字符 */
export function newVisitToken(): string {
  return randomBytes(24).toString('base64url');
}

/** 这次请求是不是走 HTTPS（Render 在反向代理后面，所以先看转发头） */
export function isSecureRequest(req: IncomingMessage): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof proto === 'string' && proto.length > 0) {
    return proto.split(',')[0]?.trim() === 'https';
  }
  return (req.socket as { encrypted?: boolean }).encrypted === true;
}

function attributes(secure: boolean): string {
  return `HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
}

export function visitCookie(token: string, secure: boolean): string {
  return `${VISIT_COOKIE}=${token}; ${attributes(secure)}`;
}

export function enteredCookie(secure: boolean): string {
  return `${ENTERED_COOKIE}=1; ${attributes(secure)}`;
}

/**
 * 真正让浏览器**删掉** `rest_note_entered`（`Max-Age=0`）。
 *
 * 新的一趟外部导航必须走这里，不能只在服务端把 entered 当成 false 用：302 到首页之后，
 * 浏览器下一次请求还会把旧的 `rest_note_entered=1` 带回来，子页又会被直接放行。
 */
export function clearEnteredCookie(secure: boolean): string {
  return `${ENTERED_COOKIE}=; ${attributes(secure)}; Max-Age=0`;
}
