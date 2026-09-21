// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * Vite 8 的 SSR module runner 用 AsyncFunction 执行模块，作用域里没有 `require`；
 * 一旦有纯 CJS 依赖（这里链条是 astro 的 glob loader → picomatch）被内联进来，
 * 就会 `require is not defined`，`astro sync` / `dev` / `build` 全部起不来
 * （最小复现见 .probe/vite-fix.mjs：单独 createServer + ssrLoadModule 也复现）。
 *
 * 这个插件只做一件事：把 node_modules 里"顶层就 require()、用 module.exports 导出"
 * 的老式 CJS 模块包一层，给它真正的 require / module / exports —— 不改写模块内容本身。
 */
const cjsInSsr = () => ({
  name: 'rest-note:cjs-in-ssr',
  enforce: 'pre',
  /** @param {string} code @param {string} id @param {{ ssr?: boolean } | undefined} options */
  transform(code, id, options) {
    if (!options?.ssr || !id.includes('node_modules') || !id.endsWith('.js')) return null;
    if (!/(^|\n)\s*(?:const|let|var)\s+\w+\s*=\s*require\(/.test(code)) return null;
    if (!/module\.exports|exports\./.test(code)) return null;
    return {
      code: [
        `import { createRequire as __createRequire } from 'node:module';`,
        `const __require = __createRequire(import.meta.url);`,
        `const module = { exports: {} };`,
        `const exports = module.exports;`,
        `((require) => {\n${code}\n})(__require);`,
        `export default module.exports;`,
      ].join('\n'),
      map: null,
    };
  },
});

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

  vite: {
    plugins: [cjsInSsr()],
  },
});
