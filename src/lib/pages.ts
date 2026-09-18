import { getPosts, postSlug, type Post } from '@/lib/content';
import { collectTags } from '@/lib/content';
import { getTranslation } from '@/lib/content';
import type { Lang } from '@/i18n/ui';
import type { RoutePair } from '@/lib/routes';

export const homeRoutes: RoutePair = { zh: '/', en: '/en/' };
export const blogRoutes: RoutePair = { zh: '/blog/', en: '/en/blog/' };
export const labRoutes: RoutePair = { zh: '/lab/', en: '/en/lab/' };
export const aboutRoutes: RoutePair = { zh: '/about/', en: '/en/about/' };

export type PostProps = {
  post: Post;
  translation?: Post;
  newer?: Post;
  older?: Post;
  routes: RoutePair;
};

export async function buildPostProps(post: Post): Promise<PostProps> {
  const posts = await getPosts(post.data.lang);
  const index = posts.findIndex((entry) => entry.id === post.id);
  const translation = await getTranslation(post);
  const slug = postSlug(post);
  const paired = Boolean(translation);

  return {
    post,
    translation,
    newer: index > 0 ? posts[index - 1] : undefined,
    older: index >= 0 && index < posts.length - 1 ? posts[index + 1] : undefined,
    routes: {
      zh: post.data.lang === 'zh' || paired ? `/blog/${slug}/` : '/blog/',
      en: post.data.lang === 'en' || paired ? `/en/blog/${slug}/` : '/en/blog/',
    },
  };
}

export async function postStaticPaths(lang: Lang) {
  const posts = await getPosts(lang);
  return Promise.all(
    posts.map(async (post) => ({
      params: { slug: postSlug(post) },
      props: await buildPostProps(post),
    })),
  );
}

export async function tagStaticPaths(lang: Lang, base: RoutePair) {
  const posts = await getPosts(lang);
  return collectTags(posts).map(({ tag }) => ({
    params: { tag },
    props: {
      tag,
      routes: {
        zh: `${base.zh}tags/${encodeURIComponent(tag)}/`,
        en: `${base.en}tags/${encodeURIComponent(tag)}/`,
      } satisfies RoutePair,
    },
  }));
}
