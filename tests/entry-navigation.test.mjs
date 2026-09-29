import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { decideEntry } from '../server/entry-router.ts';

const head = readFileSync(new URL('../src/components/BaseHead.astro', import.meta.url), 'utf8');
const earlyScript = head.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
assert.ok(earlyScript, 'the visit decision must run before the rest of the head');

function navigate({ pathname, type, token = 'visit-1', entryToken = token, hash = '' }) {
  const calls = [];
  const location = {
    pathname,
    hash,
    search: '?keep=1',
    replace: (target) => calls.push(['replace', target]),
  };
  const history = {
    state: entryToken ? { restNoteVisit: entryToken, index: 4, scrollY: 123 } : null,
    replaceState: (state, _title, target) => calls.push(['replaceState', state, target]),
  };
  const window = {
    sessionStorage: { getItem: () => token },
    history,
    location,
  };
  const context = {
    window,
    location,
    performance: { getEntriesByType: () => [{ type }] },
  };
  runInNewContext(earlyScript, context);
  return { calls, context, location };
}

test('HTTP gateway serves child HTML regardless of Entry Gate cookie or Fetch Metadata', () => {
  for (const pathname of ['/blog/a-nocturne-for-you/', '/about/intro/', '/en/blog/the-rest-note/']) {
    assert.deepEqual(decideEntry({ method: 'GET', pathname }), { kind: 'static' });
    assert.deepEqual(decideEntry({ method: 'HEAD', pathname }), { kind: 'static' });
  }
  assert.deepEqual(decideEntry({ method: 'POST', pathname: '/api/enter' }), { kind: 'enter' });
  assert.deepEqual(decideEntry({ method: 'GET', pathname: '/api/enter' }), { kind: 'method-not-allowed' });
});

test('new direct child visits go to their language home before rendering', () => {
  assert.deepEqual(navigate({ pathname: '/about/intro/', type: 'navigate' }).calls, [['replace', '/']]);
  assert.deepEqual(navigate({ pathname: '/en/blog/the-rest-note/', type: 'navigate' }).calls, [['replace', '/en/']]);
});

test('refreshing a visited article or intro leaves its URL and history untouched', () => {
  for (const pathname of ['/blog/a-nocturne-for-you/', '/about/intro/', '/en/blog/the-rest-note/']) {
    assert.deepEqual(navigate({ pathname, type: 'reload' }).calls, []);
  }
});

test('a new visit reported as reload still redirects when the history stamp is absent', () => {
  assert.deepEqual(navigate({ pathname: '/about/intro/', type: 'reload', entryToken: null }).calls, [['replace', '/']]);
});

test('ClientRouter script rerun in the same document cannot redirect a station navigation', () => {
  const state = navigate({ pathname: '/', type: 'navigate' });
  state.location.pathname = '/about/intro/';
  runInNewContext(earlyScript, state.context);
  assert.deepEqual(state.calls, []);
});

test('new visit home hash is cleared without losing query or history state', () => {
  const state = navigate({ pathname: '/', type: 'navigate', hash: '#about' });
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0][0], 'replaceState');
  assert.equal(state.calls[0][2], '/?keep=1');
  assert.equal(state.calls[0][1].restNoteVisit, 'visit-1');
});
