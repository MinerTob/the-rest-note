import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from '@/i18n/ui';
import { slugFromId } from './format';

export type Post = CollectionEntry<'blog'>;

export type Experiment = CollectionEntry<'lab'>;

export function postSlug(post: Post): string {
  return slugFromId(post.id);
}

export function postHref(post: Post): string {
  const slug = postSlug(post);
  return post.data.lang === 'zh' ? `/blog/${slug}/` : `/en/blog/${slug}/`;
}

export async function getPosts(lang: Lang): Promise<Post[]> {
  const posts = await getCollection('blog', (entry) => entry.data.lang === lang && !entry.data.draft);
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getTranslation(post: Post): Promise<Post | undefined> {
  const slug = postSlug(post);
  const target: Lang = post.data.lang === 'zh' ? 'en' : 'zh';
  const others = await getCollection(
    'blog',
    (entry) => entry.data.lang === target && !entry.data.draft,
  );
  return others.find((entry) => postSlug(entry) === slug);
}

/** 所有文章里出现过的标签，按出现次数排序 */
export function collectTags(posts: Post[]): { tag: string; count: number }[] {
  const counter = new Map<string, number>();
  posts.forEach((post) => {
    post.data.tags.forEach((tag) => counter.set(tag, (counter.get(tag) ?? 0) + 1));
  });
  return [...counter.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function getExperiments(lang: Lang): Promise<Experiment[]> {
  const items = await getCollection('lab', (entry) => entry.data.lang === lang);
  return items.sort((a, b) => a.data.order - b.data.order);
}

export async function getPage(slug: string, lang: Lang) {
  const entries = await getCollection('pages', (entry) => entry.data.lang === lang);
  return entries.find((entry) => slugFromId(entry.id) === slug);
}
