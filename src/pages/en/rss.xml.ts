import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getPosts, postHref } from '@/lib/content';
import { SITE } from '@/lib/site';

export const GET: APIRoute = async (context) => {
  const posts = await getPosts('en');

  return rss({
    title: `${SITE.name} · personal digital space`,
    description: SITE.description.en,
    site: context.site ?? SITE.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: postHref(post),
      categories: post.data.tags,
    })),
    customData: '<language>en</language>',
  });
};
