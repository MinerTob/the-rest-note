import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTACT, isInteractive } from '../src/lib/contact.ts';
import { languages, ui } from '../src/i18n/ui.ts';

/* ------------------------------------------------------------------
   Contact：只放本人给过的四种，账号本身不翻译
   ------------------------------------------------------------------ */

test('there are exactly four contact channels, in the given order', () => {
  assert.deepEqual(
    CONTACT.map((channel) => channel.id),
    ['wechat', 'email', 'bilibili', 'x'],
  );
});

test('the accounts are the ones that were actually provided', () => {
  const byId = Object.fromEntries(CONTACT.map((channel) => [channel.id, channel.value]));
  assert.equal(byId.wechat, 'MinerTob_Unearthing');
  assert.equal(byId.email, 'minertob114@gmail.com');
  assert.equal(byId.bilibili, '@MinerTob');
  assert.equal(byId.x, '@wei_yan95742');
});

test('every channel name has a translation in every language', () => {
  for (const channel of CONTACT) {
    for (const lang of Object.keys(languages)) {
      const text = ui[lang][channel.labelKey];
      assert.equal(typeof text, 'string');
      assert.ok(text.length > 0, `${channel.id} has no ${lang} name`);
    }
  }
});

test('every channel offers at least one thing to click', () => {
  for (const channel of CONTACT) {
    assert.ok(isInteractive(channel), `${channel.id} does nothing when clicked`);
  }
});

test('links to other sites open in a new tab and are https', () => {
  for (const channel of CONTACT.filter((item) => item.external)) {
    assert.ok(channel.href?.startsWith('https://'), `${channel.id} is not https`);
    assert.ok(channel.href?.startsWith('http'), `${channel.id} is not a web link`);
  }
  // 反过来：站内动作（mailto / 复制）不该被标成 external
  for (const channel of CONTACT.filter((item) => item.href && !item.external)) {
    assert.ok(channel.href?.startsWith('mailto:'), `${channel.id} should be mailto or external`);
  }
});

test('the Bilibili link goes to the profile, not to the site home', () => {
  const bilibili = CONTACT.find((channel) => channel.id === 'bilibili');
  assert.ok(bilibili?.href?.startsWith('https://space.bilibili.com/1778966676'));
  assert.equal(bilibili?.external, true);
});

test('the email row can both open a mail client and be copied', () => {
  const email = CONTACT.find((channel) => channel.id === 'email');
  assert.equal(email?.href, 'mailto:minertob114@gmail.com');
  assert.equal(email?.copy, 'minertob114@gmail.com');
});