import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const lang = z.enum(['zh', 'en']);

/** 保留 `文件名.zh.md` / `文件名.en.md` 里的语言后缀，方便两种语言配对。 */
const generateId = ({ entry }: { entry: string }) => entry.replace(/\.(md|mdx)$/, '');

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}', generateId }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    lang,
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const lab = defineCollection({
  loader: glob({ base: './src/content/lab', pattern: '**/*.{md,mdx}', generateId }),
  schema: z.object({
    title: z.string(),
    summary: z.string().default(''),
    lang,
    status: z.enum(['online', 'building', 'planned']).default('planned'),
    order: z.number().default(99),
    /** 需要在页面上渲染的交互组件 */
    component: z.enum(['minilab']).optional(),
    link: z.string().optional(),
  }),
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.{md,mdx}', generateId }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    lang,
  }),
});

export const collections = { blog, lab, pages };
