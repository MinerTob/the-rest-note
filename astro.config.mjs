// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // TODO: 部署时改成你的正式域名（影响 canonical、RSS、sitemap）
  site: 'https://example.com',

  i18n: {
    locales: ['zh', 'en'],
    defaultLocale: 'zh',
    routing: {
      // 中文在根路径（/blog），英文加前缀（/en/blog）
      prefixDefaultLocale: false,
    },
  },

  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'zh',
        locales: { zh: 'zh-CN', en: 'en' },
      },
    }),
  ],

  prefetch: {
    defaultStrategy: 'hover',
  },

  build: {
    inlineStylesheets: 'auto',
  },

  devToolbar: {
    enabled: false,
  },
});
