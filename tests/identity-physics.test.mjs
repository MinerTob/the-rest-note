import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import Matter from 'matter-js';

// 用真实 Matter 引擎推进时间；只替换布局和浏览器事件边界。
function scene() {
  let engine, resize;
  const frames = new Map();
  const handlers = new Map();
  let id = 0, clock = 0;
  const tag = { dataset: { identityLink: '/about/intro/' }, offsetWidth: 240,
    offsetHeight: 64, style: {}, focus() {}, setPointerCapture() {},
    hasPointerCapture: () => false,
    addEventListener(type, callback) { handlers.set(type, callback); } };
  const layer = { style: {}, remove() {} };
  const root = { dataset: {}, getBoundingClientRect: () => ({ left: 0, right: 800 }),
    querySelector: selector => selector === '[data-identity-arena]' ? layer :
      { getBoundingClientRect: () => ({ bottom: 608 }) } };
  const context = { exports: {}, require: () => ({ ...Matter, Engine: { ...Matter.Engine,
    create: options => (engine = Matter.Engine.create(options)) } }),
    AbortController, performance: { now: () => clock }, scrollY: 0,
    matchMedia: () => ({ matches: false }),
    document: { hidden: false, documentElement: { clientWidth: 800 },
      body: { append() {} }, querySelector: () => root, addEventListener() {} },
    window: { addEventListener() {}, setTimeout: () => 1, clearTimeout() {} },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() {} },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
  };
  const source = readFileSync(new URL('../src/scripts/identity-physics.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, context);
  const physics = context.exports.createIdentityPhysics(root, [tag]);
  return { physics, resize: () => resize(),
    pointer(type, x, y) { handlers.get(type)({ type, button: 0, pointerId: 1,
      clientX: x, clientY: y, preventDefault() {} }); },
    body: () => Matter.Composite.allBodies(engine.world).find(b => !b.isStatic),
    advance(count) { for (let i = 0; i < count; i++) {
      clock += 1000 / 60;
      const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(clock));
    } },
  };
}

test('language restoration resumes gravity and settles without a second reveal', () => {
  const s = scene();
  s.physics.restore({ floor: 600, items: [{ x: 400, y: 200, angle: 0 }] });
  s.physics.markPlaced();
  s.advance(20);
  assert.ok(s.body().position.y > 220);
  s.advance(500);
  assert.ok(s.body().isSleeping);
  assert.ok(s.body().position.y > 550 && s.body().position.y < 600);
  s.physics.dispose();
});

test('unchanged layout measurements leave settled bodies asleep', () => {
  const s = scene();
  s.physics.reveal(0, { x: 400, y: 350 }); s.advance(600);
  assert.ok(s.body().isSleeping);
  const y = s.body().position.y;
  s.resize(); s.advance(2);
  assert.ok(s.body().isSleeping);
  assert.equal(s.body().position.y, y);
  s.physics.dispose();
});

test('restored and freshly revealed intro tags have identical rotational weight', () => {
  const s = scene();
  s.physics.reveal(0, { x: 400, y: 350 });
  const inertia = s.body().inertia;
  const layout = s.physics.snapshot();
  s.physics.reset(); s.physics.restore(layout);
  assert.equal(s.body().inertia, inertia);
  s.physics.reveal(0, { x: 400, y: 350 });
  assert.equal(s.body().inertia, inertia);
  s.physics.dispose();
});

test('a held tag follows the grab point and falls after release', () => {
  const s = scene();
  s.physics.restore({ floor: 600, items: [{ x: 300, y: 350, angle: 0 }] });
  s.pointer('pointerdown', 300, 350);
  s.pointer('pointermove', 440, 250);
  s.advance(90);
  assert.ok(Math.hypot(s.body().position.x - 440, s.body().position.y - 250) < 8);
  s.pointer('pointerup', 440, 250);
  s.advance(30);
  assert.ok(s.body().position.y > 300);
  s.advance(600);
  assert.ok(s.body().isSleeping);
  s.physics.dispose();
});
