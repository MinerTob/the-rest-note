/**
 * 临时"音频飞行记录仪"（**纯诊断**，随时可以整份删掉）
 * ------------------------------------------------------------------
 * 背景：SAME VISIT 刷新时音频（MP3 / MIDI）的自动恢复是**间歇性**失败的。要查清"失败
 * 那一次到底走到哪一步"，需要在不改任何控制流的前提下，把刷新前后那一刻的音频状态记全。
 *
 * 输出两份（写法固定，方便本人直接复制回来）：
 *   1. `console.info('[audio-flight]', type, entry)` —— 每条都带统一前缀；
 *   2. sessionStorage 的 ring buffer（key `debug.audio-flight.v1`，最多 200 条，超出丢最旧）。
 *      **不清上一轮**：刷新之后仍能看到前一个 boot 与当前 boot（再配合 DevTools 的 Preserve log）。
 *
 * 铁律：**只读、只写日志**。不改任何音频状态、不加定时器、不重试、不等待、不 preventDefault。
 * 任何读取 / 序列化失败（隐私模式、存储被禁、循环引用）都静默吞掉，绝不影响功能。
 * 诊断结束：删掉这个文件 + 各文件里的 `recordAudioFlight(...)` 调用即可，不留其它痕迹。
 */

/** sessionStorage 里的 key（带版本，便于以后换格式） */
export const AUDIO_FLIGHT_KEY = 'debug.audio-flight.v1';
/** ring buffer 上限：超过就丢最旧的 */
const MAX_ENTRIES = 200;

/** 这一次**文档**（boot）的随机 id：同一个 boot 的所有记录共用，便于把刷新前后分开看 */
export const audioFlightBootId: string = makeBootId();

/** 本 boot 内的自增序号（跨 boot 用 bootId 区分） */
let seq = 0;

export type AudioFlightEntry = {
  seq: number;
  bootId: string;
  type: string;
  /** performance.now()：同一 boot 内的相对时间轴 */
  t: number;
  /** Date.now()：跨 boot 的绝对时间 */
  at: number;
  path: string;
  nav: string | null;
  readyState: string;
  visibility: string;
  /** 是否处在"用户激活"窗口里（自动播放策略的关键读数） */
  activationActive: boolean | null;
  activationEverActive: boolean | null;
  /** visit-session 写在 <html data-visit> 上的 new / same */
  visit: string | null;
  /** 这一条自己的数据 */
  [key: string]: unknown;
};

function makeBootId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/** 这次文档加载的导航类型（拿不到就是 null） */
function navigationType(): string | null {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type ?? null;
  } catch {
    return null;
  }
}

/** navigator.userActivation 的只读快照（老浏览器没有就是 null） */
function activationSnapshot(): { isActive: boolean | null; hasBeenActive: boolean | null } {
  try {
    const activation = (
      navigator as Navigator & {
        userActivation?: { isActive?: boolean; hasBeenActive?: boolean };
      }
    ).userActivation;
    return {
      isActive: activation?.isActive ?? null,
      hasBeenActive: activation?.hasBeenActive ?? null,
    };
  } catch {
    return { isActive: null, hasBeenActive: null };
  }
}

/** 出错对象的可读信息（catch 里用；不依赖它是不是 Error 实例） */
export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown };
    return {
      name: typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
      message: typeof candidate.message === 'string' ? candidate.message : String(error),
    };
  }
  return { name: 'UnknownError', message: String(error) };
}

/**
 * 音频元素此刻的原生读数（`<audio>` 的所有关键字段）。
 * 纯读属性，不碰播放状态。
 */
export function describeMediaElement(el: HTMLMediaElement): Record<string, unknown> {
  return {
    paused: el.paused,
    readyState: el.readyState,
    networkState: el.networkState,
    currentTime: Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : null,
    duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : null,
    volume: Number(el.volume.toFixed(3)),
    muted: el.muted,
    loop: el.loop,
    playbackRate: el.playbackRate,
    errorCode: el.error?.code ?? null,
    src: el.currentSrc || el.src || null,
  };
}

/**
 * 记一条。**永远不抛**：任何一步失败都静默跳过，绝不打断调用它的音频逻辑。
 *
 * @param type 事件名（如 `attemptStart.beforePlay`），前缀统一由这里加
 * @param data 这一条自己的字段（保持小、可 JSON 序列化）
 */
export function recordAudioFlight(type: string, data?: Record<string, unknown>): void {
  try {
    const activation = activationSnapshot();
    const entry: AudioFlightEntry = {
      seq: (seq += 1),
      bootId: audioFlightBootId,
      type,
      t: Number(performance.now().toFixed(1)),
      at: Date.now(),
      path: location.pathname,
      nav: navigationType(),
      readyState: document.readyState,
      visibility: document.visibilityState,
      activationActive: activation.isActive,
      activationEverActive: activation.hasBeenActive,
      visit: document.documentElement.dataset.visit ?? null,
      ...(data ?? {}),
    };

    // 1) 控制台（用户勾 Preserve log 就能看到刷新前后两个 boot）
    console.info('[audio-flight]', type, entry);

    // 2) sessionStorage 的 ring buffer：追加一条、保留上一轮、超过上限丢最旧
    try {
      const raw = window.sessionStorage.getItem(AUDIO_FLIGHT_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const list: AudioFlightEntry[] = Array.isArray(parsed)
        ? (parsed as AudioFlightEntry[])
        : [];
      list.push(entry);
      if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
      window.sessionStorage.setItem(AUDIO_FLIGHT_KEY, JSON.stringify(list));
    } catch {
      /* 隐私模式 / 配额满 / 序列化失败：静默 */
    }
  } catch {
    /* 记录仪本身绝不允许影响音频 */
  }
}

/** 本文件被 import 时先落下一条"这个 boot 开始了"，方便把刷新前后切开 */
recordAudioFlight('boot.start', {
  href: (() => {
    try {
      return location.href;
    } catch {
      return null;
    }
  })(),
  bootId: audioFlightBootId,
});
