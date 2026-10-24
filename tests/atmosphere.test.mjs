import test from 'node:test';
import assert from 'node:assert/strict';

test('ripple renderer keeps one loop and suspends for hidden, reduced motion and the other theme', async () => {
  const saved = new Map();
  const install = (key, value) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, writable: true, configurable: true }); };
  const callbacks = new Map();
  let serial = 0, draws = 0, contexts = 0, themeChanged;
  const reduced = Object.assign(new EventTarget(), { matches: false });
  const classes = new Set();
  const canvas = Object.assign(new EventTarget(), {
    width: 0, height: 0,
    classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
    getContext: () => { contexts++; return gl; },
  });
  const gl = {
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, deleteShader() {}, deleteProgram() {},
    getProgramParameter: () => true, useProgram() {}, createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {}, getUniformLocation: () => ({}),
    uniform3f() {}, uniform2f() {}, uniform1f() {}, viewport() {}, drawArrays: () => draws++,
  };
  const ambient = { classList: { toggle() {} } };
  const doc = Object.assign(new EventTarget(), {
    hidden: false, documentElement: { dataset: { theme: 'modern' } },
    querySelector: selector => selector === '.ambient' ? ambient : canvas,
  });
  const win = Object.assign(new EventTarget(), { matchMedia: () => reduced });
  install('document', doc); install('window', win);
  install('MutationObserver', class { constructor(fn) { themeChanged = fn; } observe() {} });
  install('requestAnimationFrame', fn => { callbacks.set(++serial, fn); return serial; });
  install('cancelAnimationFrame', id => callbacks.delete(id));
  install('getComputedStyle', () => ({ getPropertyValue: () => '.8 .9 1' }));
  install('innerWidth', 390); install('innerHeight', 844); install('devicePixelRatio', 3);
  try {
    await import('../src/scripts/atmosphere.ts');
    assert.equal(callbacks.size, 1);
    assert.ok(classes.has('is-ready'));
    assert.equal(canvas.width, 488, 'pixel ratio must be capped');
    const first = callbacks.entries().next().value;
    callbacks.delete(first[0]); first[1](performance.now() + 100);
    assert.ok(draws >= 2, 'a scheduled frame actually draws the surface');
    doc.dispatchEvent(new Event('astro:page-load'));
    doc.dispatchEvent(new Event('astro:page-load'));
    assert.equal(contexts, 1, 'navigation reuses the persisted canvas context');
    assert.equal(callbacks.size, 1, 'navigation must not multiply animation loops');
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 0);
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 1);
    doc.documentElement.dataset.theme = 'baroque'; themeChanged();
    assert.equal(callbacks.size, 0);
    doc.documentElement.dataset.theme = 'modern'; themeChanged();
    reduced.matches = true; reduced.dispatchEvent(new Event('change'));
    assert.equal(callbacks.size, 0);
    reduced.matches = false; reduced.dispatchEvent(new Event('change'));
    assert.equal(callbacks.size, 1);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    assert.equal(callbacks.size, 0);
    assert.equal(classes.has('is-ready'), false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    assert.equal(contexts, 2);
    assert.equal(callbacks.size, 1);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
