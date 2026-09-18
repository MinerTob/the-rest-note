import type { Lang } from '@/i18n/ui';

/** 2026-09-16（等宽、语言中立，用在列表里） */
export function formatIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 2026年9月16日 / 16 Sep 2026 */
export function formatLongDate(date: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', {
    year: 'numeric',
    month: lang === 'zh' ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * 阅读时长估算：中文字符按 380 字/分钟，西文按 200 词/分钟。
 */
export function readingMinutes(text: string | undefined): number {
  const source = text ?? '';
  const cjk = source.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const latin = source
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9'’-]+/g)?.length ?? 0;
  return Math.max(1, Math.round(cjk / 380 + latin / 200));
}

/** 从内容集合的 id 里取出 slug：hello-world.zh -> hello-world */
export function slugFromId(id: string): string {
  return id.replace(/\.(zh|en)$/, '');
}
