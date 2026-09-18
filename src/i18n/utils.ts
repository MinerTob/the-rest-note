import { defaultLang, languages, ui, type Lang, type UIKey } from './ui';

export { languages, defaultLang, locales } from './ui';
export type { Lang, UIKey } from './ui';

/** 从 URL 判断当前语言：/en/... 是英文，其余是中文。 */
export function getLangFromUrl(url: URL | string): Lang {
  const pathname = typeof url === 'string' ? url : url.pathname;
  const [, maybeLang] = pathname.split('/');
  if (maybeLang && maybeLang in languages) {
    return maybeLang as Lang;
  }
  return defaultLang;
}

/** 取文案函数（带回退，key 缺失时用默认语言）。 */
export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return ui[lang][key] ?? ui[defaultLang][key];
  };
}

/** 模板填空：fill('{n} 分钟', { n: 3 }) */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** 去掉路径里的语言前缀：/en/blog/x -> /blog/x */
export function stripLangPrefix(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 0 && parts[0] in languages) {
    parts.shift();
  }
  return '/' + parts.join('/');
}

/**
 * 生成目标语言的等价路径。
 * localizePath('/blog/x', 'en') -> '/en/blog/x'
 * localizePath('/blog/x', 'zh') -> '/blog/x'
 */
export function localizePath(pathname: string, lang: Lang): string {
  const base = stripLangPrefix(pathname);
  if (lang === defaultLang) {
    return base;
  }
  return base === '/' ? `/${lang}/` : `/${lang}${base}`;
}

/** 判断两个语言是否互为切换目标。 */
export function otherLang(lang: Lang): Lang {
  return lang === 'zh' ? 'en' : 'zh';
}

/** 带尾斜杠的规范路径（避免 ClientRouter 出现重复路径）。 */
export function normalizePath(pathname: string): string {
  if (pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}
