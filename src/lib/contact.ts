import type { UIKey } from '@/i18n/ui';

/**
 * 联系方式 —— 只放本人给过的东西，一个字段都不补。
 *
 * 这里刻意没有"欢迎联系""期待交流"这类话：面板只负责把账号和地址
 * 摆出来，表达交给界面本身。
 *
 * 一条记录只有两种形态：
 *   - 有 href：整行是一个链接（站外地址新标签页打开，mailto 交给系统）
 *   - 只有 copy：整行是一个复制按钮
 * 两者都有时，行主体走 href，右侧另给一个复制入口。
 *
 * 要加一条：往数组里加一项，再去 i18n/ui.ts 补一个对应的 labelKey。
 */
export type ContactChannel = {
  id: string;
  /** 通道名（微信 / WeChat）：属于界面文案，放 i18n */
  labelKey: UIKey;
  /** 账号 / 邮箱 / 用户名。原样显示，任何语言下都不翻译。 */
  value: string;
  /** 要复制到剪贴板的内容。没有就不给复制入口。 */
  copy?: string;
  /** 主要动作：站外地址或 mailto:。没有就说明这一行只负责复制。 */
  href?: string;
  /** 站外链接：新标签页打开，并带上 rel="noopener noreferrer" */
  external?: boolean;
};

export const CONTACT: readonly ContactChannel[] = [
  {
    id: 'wechat',
    labelKey: 'contact.wechat',
    value: 'MinerTob_Unearthing',
    copy: 'MinerTob_Unearthing',
  },
  {
    id: 'email',
    labelKey: 'contact.email',
    value: 'minertob114@gmail.com',
    copy: 'minertob114@gmail.com',
    href: 'mailto:minertob114@gmail.com',
  },
  {
    id: 'bilibili',
    labelKey: 'contact.bilibili',
    value: '@MinerTob',
    href: 'https://space.bilibili.com/1778966676?spm_id_from=333.1007.0.0',
    external: true,
  },
  {
    id: 'x',
    labelKey: 'contact.x',
    value: '@wei_yan95742',
    href: 'https://x.com/wei_yan95742',
    external: true,
  },
];

/** 这一行有没有可以点的东西 —— 没有就不渲染成可交互元素 */
export function isInteractive(channel: ContactChannel): boolean {
  return Boolean(channel.href || channel.copy);
}