/**
 * UI 文案字典。
 *
 * 设计约定：
 * - 所有界面文案都放在这里，页面/组件只通过 t('key') 取值。
 * - 不复制两套页面：同一份页面代码同时服务 zh / en。
 * - LCD / 设备风格的读数（LOCAL TIME、MINILAB、MIDI 等）保持英文，
 *   这是设备语气，不是漏翻译。
 * - 这里只放"界面文案"。不要在这里写自我介绍、个人宣言或任何
 *   未经本人确认的个人信息 —— 宁可少写，也不要编造。
 */

export const languages = {
  zh: { label: '中文', short: 'ZH', htmlLang: 'zh-CN' },
  en: { label: 'English', short: 'EN', htmlLang: 'en' },
} as const;

export type Lang = keyof typeof languages;

export const defaultLang: Lang = 'zh';
export const locales = Object.keys(languages) as Lang[];

const zh = {
  'site.tagline': '个人数字空间',

  'a11y.skip': '跳到主要内容',
  'a11y.external': '在新窗口打开',

  'nav.home': '首页',
  'nav.blog': '文章',
  'nav.github': 'GitHub',
  'nav.lab': '实验室',
  'nav.about': '关于',
  'nav.menu': '导航',

  'lang.switch': '切换语言',
  'lang.to.en': '切换到 English',
  'lang.to.zh': '切换到中文',

  'home.recent': '最近',
  'home.recent.all': '全部文章',
  'home.contact': '联系我',
  'home.lab': '实验室',
  'home.lab.note': '25 键 MiniLab · Web MIDI · 音频实验',
  'home.empty': '还没有文章。',

  'contact.wechat': '微信',
  'contact.email': '邮箱',
  'contact.bilibili': '哔哩哔哩',
  'contact.x': 'X',
  'contact.copy': '复制',
  'contact.copied': '已复制',

  'clock.label': 'LOCAL TIME',
  'system.label': 'SYSTEM',

  'sys.blog': '博客',
  'sys.music': '音乐',
  'sys.lab': '实验室',
  'sys.online': '在线',
  'sys.ready': '就绪',
  'sys.idle': '空闲',

  'music.title': 'MUSIC SYSTEM',
  'music.nowPlaying': '正在播放',
  'music.play': '播放',
  'music.pause': '暂停',
  'music.volume': '音量',
  'music.mute': '静音',
  'music.unmute': '取消静音',
  'music.state.ready': 'READY',
  'music.state.active': 'ACTIVE',
  'music.state.paused': 'PAUSED',
  'music.unsupported': '这个浏览器不能播放音频。',
  'music.noTrack': '没有可用的曲目。',



  'lab.title': 'LAB',
  'lab.intro': '实验区域。',
  'lab.experiment': 'EXPERIMENT',
  'lab.status.online': '可用',
  'lab.status.building': '构建中',
  'lab.status.planned': '计划中',
  'lab.empty': '实验室目前是空的。',
  'lab.controller': 'MINILAB CONTROLLER',

  'midi.label': 'MIDI',
  'midi.status.unsupported': 'NOT SUPPORTED',
  'midi.status.ready': 'READY',
  'midi.status.none': 'NO DEVICE',
  'midi.status.live': 'LIVE',
  'midi.devices': '输入设备',
  'midi.noDevice': '未检测到设备',
  'midi.inputHint': '连接一个 MIDI 键盘即可弹奏。',

  'minilab.title': 'MINILAB',
  'minilab.keys': '25 KEYS',
  'minilab.note': 'NOTE',
  'minilab.aria': '25 键虚拟钢琴',
  'minilab.keyAria': '{note} 琴键',
  'minilab.help': '鼠标或触摸点击琴键，也可以用电脑键盘 Z–M 与 Q–I 弹奏。',
  'minilab.ready': 'READY',
  'minilab.engine': 'ENGINE',
  'minilab.engine.idle': 'STANDBY',
  'minilab.engine.loading': 'LOADING',
  'minilab.engine.ready': 'READY',
  'minilab.engine.failed': 'NO SAMPLES',
  'minilab.source': '音源',
  'minilab.source.credit': 'Salamander Grand Piano · Alexander Holm · CC BY 3.0',

  'blog.title': 'BLOG',
  'blog.intro': '笔记与记录。',
  'blog.all': '全部',
  'blog.tags': '标签',
  'blog.readingTime': '{n} 分钟',
  'blog.published': '发布于',
  'blog.updated': '更新于',
  'blog.toc': '本页目录',
  'blog.prev': '上一篇',
  'blog.next': '下一篇',
  'blog.back': '返回文章列表',
  'blog.empty': '这里还没有内容。',
  'blog.noTranslation': '这篇目前只有中文版本。',

  'about.title': 'ABOUT',
  'about.tools': '常用工具',
  'about.site': '这个网站',
  'about.credits': '音源与许可',
  'about.identity': '身份标签',
  'identity.readout': '88 键 · 待接入',

  'footer.rights': '保留所有权利',
  'footer.built': '用 Astro 构建',
  'footer.rss': 'RSS 订阅',
  'footer.top': '回到顶部',
  /* 解锁之后才出现的小控制器（设备语气，中英都保持一致） */
  'theme.label': 'THEME',
  'theme.switch': '切换到 {theme} 主题',

  'error.title': '404',
  'error.text': '没有找到这个页面。',
  'error.back': '回到首页',
};

export type UIKey = keyof typeof zh;

const en: Record<UIKey, string> = {
  'site.tagline': 'Personal digital space',

  'a11y.skip': 'Skip to content',
  'a11y.external': 'opens in a new tab',

  'nav.home': 'Home',
  'nav.blog': 'Blog',
  'nav.github': 'GitHub',
  'nav.lab': 'Lab',
  'nav.about': 'About',
  'nav.menu': 'Navigation',

  'lang.switch': 'Switch language',
  'lang.to.en': 'Switch to English',
  'lang.to.zh': 'Switch to Chinese',

  'home.recent': 'Recent',
  'home.recent.all': 'All posts',
  'home.contact': 'CONTACT',
  'home.lab': 'Lab',
  'home.lab.note': '25-key MiniLab · Web MIDI · audio experiments',
  'home.empty': 'No notes yet.',

  'contact.wechat': 'WeChat',
  'contact.email': 'Email',
  'contact.bilibili': 'Bilibili',
  'contact.x': 'X',
  'contact.copy': 'COPY',
  'contact.copied': 'COPIED',

  'clock.label': 'LOCAL TIME',
  'system.label': 'SYSTEM',

  'sys.blog': 'Blog',
  'sys.music': 'Music',
  'sys.lab': 'Lab',
  'sys.online': 'online',
  'sys.ready': 'ready',
  'sys.idle': 'idle',

  'music.title': 'MUSIC SYSTEM',
  'music.nowPlaying': 'Now playing',
  'music.play': 'Play',
  'music.pause': 'Pause',
  'music.volume': 'Volume',
  'music.mute': 'Mute',
  'music.unmute': 'Unmute',
  'music.state.ready': 'READY',
  'music.state.active': 'ACTIVE',
  'music.state.paused': 'PAUSED',
  'music.unsupported': 'This browser cannot play audio.',
  'music.noTrack': 'No track available.',



  'lab.title': 'LAB',
  'lab.intro': 'The experiment area.',
  'lab.experiment': 'EXPERIMENT',
  'lab.status.online': 'online',
  'lab.status.building': 'building',
  'lab.status.planned': 'planned',
  'lab.empty': 'The lab is empty for now.',
  'lab.controller': 'MINILAB CONTROLLER',

  'midi.label': 'MIDI',
  'midi.status.unsupported': 'NOT SUPPORTED',
  'midi.status.ready': 'READY',
  'midi.status.none': 'NO DEVICE',
  'midi.status.live': 'LIVE',
  'midi.devices': 'Inputs',
  'midi.noDevice': 'No device detected',
  'midi.inputHint': 'Connect a MIDI keyboard to play.',

  'minilab.title': 'MINILAB',
  'minilab.keys': '25 KEYS',
  'minilab.note': 'NOTE',
  'minilab.aria': '25-key virtual piano',
  'minilab.keyAria': 'Key {note}',
  'minilab.help': 'Click or tap the keys, or play with Z–M and Q–I on your keyboard.',
  'minilab.ready': 'READY',
  'minilab.engine': 'ENGINE',
  'minilab.engine.idle': 'STANDBY',
  'minilab.engine.loading': 'LOADING',
  'minilab.engine.ready': 'READY',
  'minilab.engine.failed': 'NO SAMPLES',
  'minilab.source': 'Source',
  'minilab.source.credit': 'Salamander Grand Piano · Alexander Holm · CC BY 3.0',

  'blog.title': 'BLOG',
  'blog.intro': 'Notes and records.',
  'blog.all': 'All',
  'blog.tags': 'Tags',
  'blog.readingTime': '{n} min read',
  'blog.published': 'Published',
  'blog.updated': 'Updated',
  'blog.toc': 'On this page',
  'blog.prev': 'Previous',
  'blog.next': 'Next',
  'blog.back': 'Back to all posts',
  'blog.empty': 'Nothing here yet.',
  'blog.noTranslation': 'This note is only available in Chinese.',

  'about.title': 'ABOUT',
  'about.tools': 'Tools',
  'about.site': 'This site',
  'about.credits': 'Audio credits',
  'about.identity': 'IDENTITY',
  'identity.readout': '88 KEYS · PENDING',

  'footer.rights': 'All rights reserved',
  'footer.built': 'Built with Astro',
  'footer.rss': 'RSS feed',
  'footer.top': 'Back to top',
  'theme.label': 'THEME',
  'theme.switch': 'Switch to the {theme} theme',

  'error.title': '404',
  'error.text': 'This page was not found.',
  'error.back': 'Back home',
};

export const ui = { zh, en } as const;
