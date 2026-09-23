import { getGlobal } from './global';
import { getDocumentLang } from './lang';

/**
 * LCD 本地时间（访客所在地）
 * ==================================================================
 * 最终地点来自一次 IP 定位（`ipwho.is`）：`city` + `timezone.id`。
 *
 * 不变量：
 *   1. 先用浏览器时区显示时间；IP 定位成功后切换到 IP 的 IANA 时区。
 *      计时器照旧只建一个（`setInterval`）。
 *   2. 时区只用 IANA id + `Intl.DateTimeFormat`（DST / 夏令时交给浏览器，自己不算偏移、不维护表）。
 *   3. IP 成功后立刻改用对应时区（**不等翻译**）；城市名分三条路：
 *      英文页立即显示原始 city；中文页先查 `SPECIAL_CITY_ZH`（命中即用本地中文名、不调 Worker），
 *      未命中则先显示原始城市、异步问 Translate Worker，成功显示译文、失败保留原名。
 *   4. IP 查询失败只影响城市和最终定位，时钟继续显示浏览器当地时间。
 *   5. 只改这四样文本：`[data-clock-time]` / `[data-clock-date]` / `[data-clock-zone]` / 城市名。
 *      结构 / class / CSS / 布局全部原样。
 */
/** IP 定位端点（请求时再拼一个 `?_=时间戳`，见 `fetchVisitorLocation()` —— 必须绕开缓存） */
const LOCATION_ENDPOINT = 'https://ipwho.is/';

/**
 * 现有 Cloudflare Translate Worker（Google Translate 中转）—— 本人已在浏览器 Console 真人验证：
 *
 *   GET https://ximu-translate.yanfangwei467.workers.dev/?sl=en&tl=zh-CN&q=Tokyo
 *   → 200，返回 JSON 数组：["东京"]，译文就是 `data[0]`
 *
 * 本轮按"先证明链路正确"的要求**直接写死这个公开地址**（下一轮再抽成环境变量 / Render Settings）。
 * 不要另写 Worker、不要接第二个翻译 API、不要复制 Cloudflare 代码进前端。
 */
const TRANSLATE_ENDPOINT = 'https://ximu-translate.yanfangwei467.workers.dev/';

type VisitorLocation = { city: string; timeZone: string; cityZh?: string; translation?: Promise<string | null> };

/** 这一趟文档查到的访客位置：换页回到带时钟的页面时直接复用，不重复打第三方接口 */
let visitorLocation: VisitorLocation | null = null;
/** 同一文档只发一次请求（失败也记住，不反复打扰网络） */
let locationLookup: Promise<VisitorLocation | null> | null = null;

/**
 * 少量"特殊地名"的本地中文名：只覆盖**常见固定译名 / 已知容易被机翻翻错**的城市。
 * 只用于中文页；命中就直接用这里的中文名、**不再请求 Translate Worker**。
 *
 * 特别说明：`seoul` 必须留在这里 —— 机翻常给"汉城"，本页要的是"首尔"。
 * **不要**把它扩成全球城市表：没命中的城市交给 Worker 自动翻译（见 `applyLocation()`）。
 */
const SPECIAL_CITY_ZH: Record<string, string> = {
  seoul: '首尔',

  'hong kong': '香港',
  hongkong: '香港',

  taipei: '台北',
  'taipei city': '台北',

  beijing: '北京',
  'beijing city': '北京',

  shanghai: '上海',
  'shanghai city': '上海',

  guangzhou: '广州',
  shenzhen: '深圳',

  chongqing: '重庆',
  'chongqing city': '重庆',

  nanning: '南宁',

  tokyo: '东京',
  'tokyo city': '东京',

  osaka: '大阪',
  kyoto: '京都',
  yokohama: '横滨',
  nagoya: '名古屋',
  sapporo: '札幌',
  kobe: '神户',
  fukuoka: '福冈',
  hiroshima: '广岛',
  sendai: '仙台',
  naha: '那霸',

  singapore: '新加坡',

  'los angeles': '洛杉矶',

  'new york': '纽约',
  'new york city': '纽约',

  'san francisco': '旧金山',

  washington: '华盛顿',
  'washington dc': '华盛顿',
  'washington d.c.': '华盛顿',
  'washington, dc': '华盛顿',
  'washington, d.c.': '华盛顿',

  london: '伦敦',
  paris: '巴黎',
  rome: '罗马',
  munich: '慕尼黑',
  moscow: '莫斯科',
};

/**
 * 只用于**查本地字典**的匹配 key：大小写不敏感 + 把连续空白压成一个空格。
 * 绝不用它去请求 Worker、也绝不用它当显示文本 —— 原始 city 的大小写必须原样保留。
 */
function normalizeCityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

type ClockFormatters = {
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  zone: Intl.DateTimeFormat;
};

function buildFormatters(timeZone: string): ClockFormatters {
  return {
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    date: new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }),
    // longOffset 直接给出 "GMT+08:00" 这种带偏移的名字；老引擎不认这个值时退化成只带时区名
    zone: buildZoneFormatter(timeZone),
  };
}

function buildZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'longOffset' });
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone });
  }
}

/** 这个 IANA id 浏览器认不认（API 返回脏值时整体放弃，别把时钟搞崩） */
function isUsableTimeZone(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/**
 * 由**当前 Date + 当前 IANA 时区**算 UTC 偏移标签（`UTC+08:00` / `UTC-07:00`）。
 * 先用 `timeZoneName: 'longOffset'` 的 `GMT±HH:MM`，只把 GMT 换成 UTC；
 * 拿不到（老引擎把它退化成时区名）时用"墙上时间与 UTC 的差"兜底 —— 两种都不写死偏移、不查 DST 表。
 */
function zoneOffsetLabel(formatter: Intl.DateTimeFormat, timeZone: string, now: Date): string {
  const name =
    formatter.formatToParts(now).find((part) => part.type === 'timeZoneName')?.value ?? '';

  // 整点时区（伦敦冬令时、UTC 本身）longOffset 会给 "GMT"，要补成 UTC+00:00
  if (name === 'GMT' || name === 'UTC') return 'UTC+00:00';

  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(name);
  if (match) {
    const [, sign, hours, minutes = '00'] = match;
    return `UTC${sign}${hours.padStart(2, '0')}:${minutes}`;
  }

  return wallClockOffsetLabel(timeZone, now);
}

/** 兜底：把同一时刻在目标时区的"墙上时间"当作 UTC 再与真实 UTC 相减 */
function wallClockOffsetLabel(timeZone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now);
    const pick = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    const wall = Date.UTC(
      pick('year'),
      pick('month') - 1,
      pick('day'),
      pick('hour') % 24,
      pick('minute'),
      pick('second'),
    );
    const minutes = Math.round((wall - Math.floor(now.getTime() / 1000) * 1000) / 60000);
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/** 只写城市名（多个面板都写）；响应回来时面板可能已被客户端路由换掉，离线的节点不写 */
function applyCity(panels: NodeListOf<HTMLElement>, city: string): void {
  panels.forEach((panel) => {
    const cityEl = panel.querySelector<HTMLElement>('.clock__city');
    if (!cityEl || !cityEl.isConnected) return;
    if (cityEl.textContent !== city) cityEl.textContent = city;
  });
}

/**
 * 用现有 Translate Worker 把城市名翻成简体中文。
 * 请求参数一律用 `URL` + `searchParams` 构造（城市名自己带空格 / 连字符 / 非 ASCII 都不用我们操心）。
 *
 * 按真人验证过的返回格式**严格校验**：必须是数组、`data[0]` 必须是字符串、去掉首尾空白后非空。
 * 任何一步不满足（网络错误 / 非 2xx / JSON 解析失败 / 不是数组 / `data[0]` 不是字符串 / 空串）
 * 都返回 null —— 调用方回退显示 `ipwho.is` 的原始英文城市名。不弹错误、不 console spam、不重试。
 */
async function translateCity(city: string): Promise<string | null> {
  try {
    const url = new URL(TRANSLATE_ENDPOINT);
    url.searchParams.set('sl', 'en');
    url.searchParams.set('tl', 'zh-CN');
    url.searchParams.set('q', city);

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (!Array.isArray(data)) return null;
    const first: unknown = data[0];
    if (typeof first !== 'string') return null;
    const translated = first.trim();
    return translated || null;
  } catch {
    return null;
  }
}

/**
 * 取一次访客位置：只用 `success` / `city` / `timezone.id` 三个字段。
 * 时区不满足（或浏览器不认）就返回 null —— 调用方保留浏览器当地时钟。
 *
 * 请求本身**明确绕开 HTTP / 浏览器缓存**：`cache: 'no-store'` + 时间戳 query。
 * 否则换了出口 IP（VPN 切地区）后，浏览器/CDN 可能继续拿上一次那份响应，页面就一直保持旧定位。
 * 同一文档内仍然只请求一次（`locationLookup` 的单飞缓存），真正刷新页面时模块重新初始化，
 * 这里会带着新的时间戳重新取一次当前出口 IP。
 */
function fetchVisitorLocation(): Promise<VisitorLocation | null> {
  locationLookup ??= (async () => {
    try {
      const response = await fetch(`${LOCATION_ENDPOINT}?_=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        headers: {
          accept: 'application/json',
        },
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object') return null;

      const data = payload as { success?: unknown; city?: unknown; timezone?: { id?: unknown } };
      if (data.success !== true) return null;

      const city = typeof data.city === 'string' ? data.city.trim() : '';
      const timeZone = typeof data.timezone?.id === 'string' ? data.timezone.id.trim() : '';
      if (!timeZone || !isUsableTimeZone(timeZone)) return null;

      visitorLocation = { city, timeZone };
      return visitorLocation;
    } catch {
      /* 离线 / 被拦 / 超时：保持空白，不重试 */
      return null;
    }
  })();
  return locationLookup;
}

export function initClock(): void {
  const panels = document.querySelectorAll<HTMLElement>('[data-clock]');
  if (panels.length === 0) return;

  // 定位网络请求与音频启动互不依赖。先显示浏览器时区，定位成功后覆盖。
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let timeZone = isUsableTimeZone(localZone) ? localZone : 'UTC';
  let formatters = buildFormatters(timeZone);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 整个 clock 只有这一个 interval（IP 数据到位后不重建，tick 读当前 formatter 即可）
  const interval = window.setInterval(tick, 1000);
  getGlobal().timers.push(interval);

  tick();

  function tick(): void {
    const now = new Date();
    const parts = formatters.time.formatToParts(now);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '--';
    const time = `${pick('hour')}:${pick('minute')}:${pick('second')}`;

    const dateParts = formatters.date.formatToParts(now);
    const datePick = (type: string) => dateParts.find((part) => part.type === type)?.value ?? '';
    const dateText = `${datePick('year')}.${datePick('month')}.${datePick('day')} ${datePick('weekday').toUpperCase()}`;

    // 偏移按"当前时区 + 当前时刻"实时算：夏令时切换由 Intl 处理
    const zone = zoneOffsetLabel(formatters.zone, timeZone, now);

    panels.forEach((panel) => {
      const timeEl = panel.querySelector<HTMLElement>('[data-clock-time]');
      const dateEl = panel.querySelector<HTMLElement>('[data-clock-date]');
      const zoneEl = panel.querySelector<HTMLElement>('[data-clock-zone]');
      if (timeEl && timeEl.textContent !== time) {
        timeEl.textContent = time;
        if (!reduceMotion) {
          timeEl.classList.remove('is-tick');
          // 强制重排，让动画可以重复播放
          void timeEl.offsetWidth;
          timeEl.classList.add('is-tick');
        }
      }
      if (dateEl && dateEl.textContent !== dateText) {
        dateEl.textContent = dateText;
      }
      if (zoneEl && zoneEl.textContent !== zone) {
        zoneEl.textContent = zone;
      }
    });
  }

  /**
   * IP 数据到手：**先把能确定的全部启用**（时区 / 时间 / 日期 / UTC 偏移），再单独处理城市名 ——
   * 中文页的城市翻译是异步的，绝不阻塞上面那三样（翻译慢或失败都不影响时钟）。
   *
   * 城市名三条路：
   *   英文页            → 直接显示原始 `rawCity`（不查字典、不调 Worker）
   *   中文页 + 字典命中  → 直接用 `SPECIAL_CITY_ZH` 的中文名（**不调 Worker**）
   *   中文页 + 未命中    → city 先空白 → 异步问 Worker（q 用原始 `rawCity`）→ 成功显示译文，失败显示 `rawCity`
   */
  function applyLocation(location: VisitorLocation): void {
    // 原始城市名：大小写 / 空格全部保留，供英文页显示、Worker 的 q 参数、以及最后的 fallback
    const rawCity = location.city.trim();

    timeZone = location.timeZone;
    formatters = buildFormatters(timeZone);
    tick();
    if (!rawCity) return;

    // 英文页：只显示原始 city（不查 SPECIAL_CITY_ZH、不调 Translate Worker、不做任何小写化）
    if (getDocumentLang() !== 'zh') {
      applyCity(panels, rawCity);
      return;
    }

    // 中文页第一步：本地特殊地名词典优先
    const specialCity = SPECIAL_CITY_ZH[normalizeCityKey(rawCity)];
    if (specialCity) {
      location.cityZh = specialCity;
      applyCity(panels, specialCity);
      return;
    }

    // 中文页：之前已经翻过（同一文档里换页回来）直接用，不重复请求
    if (location.cityZh) {
      applyCity(panels, location.cityZh);
      return;
    }

    // 翻译只改善城市文案；请求过程中仍显示原始城市。
    applyCity(panels, rawCity);
    location.translation ??= translateCity(rawCity);
    void location.translation.then((translated) => {
      if (translated) location.cityZh = translated;
      // 翻译失败 → 回退显示 ipwho.is 的原始英文城市名（时钟本身不受影响）
      applyCity(panels, translated ?? rawCity);
    });
  }

  // 已经查过（同一文档里换页回来）：直接套用，不再发请求
  if (visitorLocation) {
    applyLocation(visitorLocation);
    return;
  }

  void fetchVisitorLocation().then((location) => {
    if (location) applyLocation(location);
  });
}
