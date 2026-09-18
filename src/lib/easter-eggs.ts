import type { Lang } from '@/i18n/ui';
import type { ThemeName } from './themes';

/**
 * 彩蛋配置 —— 想加新彩蛋，往数组里加一条就行，不用改 MiniLab。
 *
 * 三条铁律：
 *   1. 这些内容绝不出现在页面上，也不给访客任何文字提示。
 *   2. 每条彩蛋只在它自己的主题下存在：modern 主题里没有返回序列，
 *      baroque 主题里也没有解锁序列。提示模式按当前主题挑一条。
 *   3. 提示模式一次只亮一个键，绝不显示完整序列、进度数字或"下一个音"。
 */

export type EasterEgg = {
  id: string;
  /** 只有当前主题等于它时，这条彩蛋才存在（提示模式也才会被点亮） */
  theme: ThemeName;
  /** 需要依次弹出的音符 */
  notes: string[];
  /** 相邻两个音符的最大间隔（毫秒），超过就重新开始 */
  maxGapMs: number;
  /** 触发瞬间的 LCD 系统提示（设备语气，保持英文） */
  message: string;
  /** 提示下面的第二行小字（可选） */
  detail?: Record<Lang, string>;
  /** 进入提示模式时那一行极短的 LCD 文字 —— 不能泄露答案 */
  hintLabel: string;
  /** 完成后解锁的隐藏曲目（可选） */
  unlocks?: string;
  /** 完成后切到的主题；曲目由 theme profile 决定 */
  resultTheme: ThemeName;
};

export const EASTER_EGGS: EasterEgg[] = [
  {
    id: 'unlock-canon',
    theme: 'modern',
    notes: ['G4', 'E4', 'F4', 'G4'],
    maxGapMs: 2600,
    message: 'SEQUENCE ACCEPTED',
    detail: { zh: '音频与主题已切换', en: 'audio and theme rerouted' },
    hintLabel: 'LISTEN',
    unlocks: 'canon',
    resultTheme: 'baroque',
  },
  {
    id: 'return-modern',
    theme: 'baroque',
    notes: ['C#5', 'E5', 'E5'],
    maxGapMs: 2600,
    message: 'SEQUENCE ACCEPTED',
    detail: { zh: '已回到默认主题', en: 'back to the default theme' },
    hintLabel: 'LISTEN',
    resultTheme: 'modern',
  },
];

/** 当前主题下可用的那条彩蛋；没有就返回 undefined */
export function eggForTheme(theme: ThemeName): EasterEgg | undefined {
  return EASTER_EGGS.find((egg) => egg.theme === theme);
}

export function eggById(id: string): EasterEgg | undefined {
  return EASTER_EGGS.find((egg) => egg.id === id);
}

export const EGG_SEQUENCES = EASTER_EGGS.map((egg) => egg.notes);