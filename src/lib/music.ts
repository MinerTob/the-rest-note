import type { Lang } from '@/i18n/ui';

/**
 * 音乐系统配置。
 *
 * - 音频文件放在 public/music/ 下，浏览器通过 /music/xxx.mp3 访问。
 *   绝对不要引用本机路径（例如 D:\MuseScore4\...），浏览器读不到，也不该读到。
 * - 不想让别人在列表里看到/选到的曲子（例如彩蛋曲目）标记 hidden: true。
 */

export type Track = {
  id: string;
  title: string;
  subtitle?: Record<Lang, string>;
  src: string;
  credit?: Record<Lang, string>;
  hidden?: boolean;
};

export const TRACKS: Track[] = [
  {
    id: 'dao-xiang',
    title: 'DAO XIANG',
    subtitle: { zh: '钢琴', en: 'piano' },
    src: '/music/dao-xiang.mp3',
    credit: { zh: '在 MuseScore 里编的', en: 'Arranged in MuseScore' },
  },
  {
    /**
     * 彩蛋曲目。放文件到 public/music/secret/canon.mp3 才会生效；
     * 文件不存在时 crossfadeTo() 会静默失败，当前音乐继续播放。
     */
    id: 'canon',
    title: 'CANON',
    subtitle: { zh: '帕赫贝尔 · 卡农', en: 'Pachelbel · Canon' },
    src: '/music/secret/canon.mp3',
    hidden: true,
  },
];

/** 默认曲目 */
export const DEFAULT_TRACK_ID = 'dao-xiang';

/** 播放行为的默认值（音量刻意克制） */
export const AUDIO = {
  volume: 0.3,
  fadeInMs: 2400,
  /* 暂停的淡出从 1200ms 收到 450ms：按暂停是"现在停下"的意思，
     手机上那 1.2 秒的余音会被当成"UI 变了声音还在放"（见 §10）。 */
  fadeOutMs: 450,
  crossfadeMs: 2000,
} as const;

/**
 * 音量渐变的数学部分。
 *
 * 进度必须两头都夹在 [0, 1]：requestAnimationFrame 回调拿到的 now 有可能早于
 * 注册时记下的起点（同一次渲染帧里注册就会这样），负进度会让缓动反向过冲，
 * 算出 -0.003 / 1.004 这种音量。给 HTMLMediaElement.volume 赋越界值会抛
 * IndexSizeError，整条淡入当场断在半路 —— 听到的就是「切过去了，但没有声音」。
 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 缓动：先快后慢，淡入淡出都很轻 */
export function easeOutQuad(progress: number): number {
  const p = clamp01(progress);
  return 1 - (1 - p) * (1 - p);
}

/** 音量插值。返回的值保证是合法的音量。 */
export function volumeAt(from: number, to: number, progress: number): number {
  return clamp01(from + (to - from) * easeOutQuad(progress));
}
export function getTrack(id: string): Track | undefined {
  return TRACKS.find((track) => track.id === id);
}
