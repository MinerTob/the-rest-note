import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VISIT_STATE_KEY,
  navigationKind,
  readEntryToken,
  stampEntryToken,
  visitBoundary,
} from '../src/lib/visit.ts';

const TOKEN = 'visit-1';

/** 一次加载的完整信号：默认是"刚进站的那一下" */
const signals = (over = {}) => ({
  navigation: 'navigate',
  sessionToken: TOKEN,
  entryToken: TOKEN,
  ...over,
});

test('a tab with no visit id yet is always a new visit', () => {
  assert.equal(visitBoundary(signals({ sessionToken: null })), 'new');
  assert.equal(visitBoundary(signals({ sessionToken: null, navigation: 'reload' })), 'new');
  assert.equal(visitBoundary(signals({ sessionToken: null, navigation: 'back_forward' })), 'new');
});

test('typing the address bar (or following a link / bookmark) is a new visit', () => {
  // 地址栏重新输入同一个网址：Chrome 报 navigate，条目被顶掉换成新的
  assert.equal(visitBoundary(signals({ navigation: 'navigate' })), 'new');
  assert.equal(visitBoundary(signals({ navigation: 'navigate', entryToken: null })), 'new');
  assert.equal(visitBoundary(signals({ navigation: 'navigate', entryToken: 'stale' })), 'new');
});

test('a browser that reports the same-URL re-entry as a reload is still caught', () => {
  // 这条是本人报的那个 bug：有的浏览器把"地址栏重新输入同一个网址"报成 reload。
  // 新导航把历史条目顶掉了，我们盖的访问 id 不在上面 → 仍然是新访问。
  assert.equal(visitBoundary(signals({ navigation: 'reload', entryToken: null })), 'new');
  assert.equal(visitBoundary(signals({ navigation: 'reload', entryToken: 'somebody-else' })), 'new');
});

test('a genuine reload stays in the same visit', () => {
  assert.equal(visitBoundary(signals({ navigation: 'reload' })), 'same');
});

test('back / forward / bfcache restores stay in the same visit', () => {
  assert.equal(visitBoundary(signals({ navigation: 'back_forward' })), 'same');
  assert.equal(visitBoundary(signals({ navigation: 'back_forward', entryToken: null })), 'same');
});

test('an unrecognised navigation type is treated as a new visit', () => {
  assert.equal(visitBoundary(signals({ navigation: 'unknown' })), 'new');
  assert.equal(navigationKind(undefined), 'unknown');
  assert.equal(navigationKind('prerender'), 'unknown');
  assert.equal(navigationKind('reload'), 'reload');
});

test('the visit id is stamped into the history entry without dropping Astro fields', () => {
  // Astro 的客户端路由把 index / scrollX / scrollY 放在同一个 state 上，
  // 换页和刷新靠它恢复滚动位置 —— 盖章不能把它们冲掉。
  const astroState = { index: 3, scrollX: 0, scrollY: 1280 };
  const stamped = stampEntryToken(astroState, TOKEN);
  assert.deepEqual(stamped, { index: 3, scrollX: 0, scrollY: 1280, [VISIT_STATE_KEY]: TOKEN });
  assert.equal(readEntryToken(stamped), TOKEN);
  assert.deepEqual(astroState, { index: 3, scrollX: 0, scrollY: 1280 }, '原对象不动');
});

test('reading a missing / foreign history state yields null', () => {
  assert.equal(readEntryToken(null), null);
  assert.equal(readEntryToken(undefined), null);
  assert.equal(readEntryToken('nonsense'), null);
  assert.equal(readEntryToken({ index: 1 }), null);
  assert.equal(readEntryToken({ [VISIT_STATE_KEY]: '' }), null);
});
