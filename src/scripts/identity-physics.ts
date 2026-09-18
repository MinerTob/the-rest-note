import { Engine, Bodies, Body, Composite, Constraint, Sleeping } from 'matter-js';

/** A document-space playground: scrolling never moves the floor or the bodies. */
export type IdentityLayout = ({ x: number; y: number; angle: number } | null)[];

export function createIdentityPhysics(
  root: HTMLElement,
  tags: HTMLElement[],
  onSettled?: (layout: IdentityLayout) => void,
) {
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.4;
  const layer = root.querySelector<HTMLElement>('[data-identity-arena]')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const bodies = new Map<number, Body>();
  const frozen = new Set<number>();
  let walls: Body[] = [], width = 0, floor = 0, frame = 0, last = 0, accumulator = 0;
  let left = 0, right = 0;
  let settleTimer = 0;
  let drag: { index: number; pointer: number; joint: Constraint } | undefined;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  function bounds() {
    width = document.documentElement.clientWidth;
    const content = root.getBoundingClientRect();
    left = content.left;
    right = content.right;
    // Leave room below the playground for copyright and browser/system bottom bars.
    floor = root.querySelector<HTMLElement>('.identity__landing')!.getBoundingClientRect().bottom + scrollY - 8;
    layer.style.height = `${floor}px`;
    Composite.remove(engine.world, walls);
    walls = [Bodies.rectangle(width / 2, floor + 50, width + 200, 100, { isStatic: true }),
      Bodies.rectangle(left - 50, floor / 2, 100, floor * 2, { isStatic: true }),
      Bodies.rectangle(right + 50, floor / 2, 100, floor * 2, { isStatic: true })];
    Composite.add(engine.world, walls);
    bodies.forEach((b, index) => {
      const half = (b.bounds.max.x - b.bounds.min.x) / 2 + 2;
      Body.setPosition(b, { x: clamp(b.position.x, left + half, right - half), y: Math.min(b.position.y, floor - 50) });
      Sleeping.set(b, reduced.matches || frozen.has(index));
    });
    wake();
  }
  function paint() {
    bodies.forEach((b, i) => {
      tags[i].style.transform = `translate(${b.position.x - tags[i].offsetWidth / 2}px,${b.position.y - tags[i].offsetHeight / 2}px) rotate(${b.angle}rad)`;
    });
  }
  function snapshot(): IdentityLayout {
    return tags.map((_, index) => {
      const body = bodies.get(index);
      if (!body) return null;
      return {
        x: (body.position.x - left) / Math.max(1, right - left),
        y: (floor - body.position.y) / Math.max(1, floor),
        angle: body.angle,
      };
    });
  }
  function saveWhenSettled() {
    if (!onSettled || bodies.size === 0) return;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => onSettled(snapshot()), 220);
  }
  function step(stamp: number) {
    frame = 0;
    if (document.hidden) { last = 0; return; }
    if (reduced.matches && !drag) { paint(); last = 0; return; }
    accumulator += Math.min(last ? stamp - last : 16.667, 50);
    last = stamp;
    while (accumulator >= 1000 / 60) { Engine.update(engine, 1000 / 60); accumulator -= 1000 / 60; }
    paint();
    if (drag || [...bodies.values()].some(b => !b.isSleeping)) frame = requestAnimationFrame(step);
    else { last = 0; saveWhenSettled(); }
  }
  function wake() { if (!frame) { last = 0; frame = requestAnimationFrame(step); } }
  function release() {
    if (!drag) return;
    Composite.remove(engine.world, drag.joint);
    const el = tags[drag.index], pointer = drag.pointer;
    drag = undefined;
    el.dataset.dragging = 'false';
    if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
    window.setTimeout(saveWhenSettled, 260);
    wake();
  }
  tags.forEach((el, index) => {
    el.addEventListener('pointerdown', e => {
      const b = bodies.get(index);
      if (!b || drag || e.button !== 0) return;
      e.preventDefault();
      frozen.delete(index);
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      Sleeping.set(b, false);
      const joint = Constraint.create({ pointA: { x: e.clientX, y: e.clientY + scrollY }, bodyB: b,
        pointB: { x: e.clientX - b.position.x, y: e.clientY + scrollY - b.position.y }, stiffness: .18, damping: .12, length: 0 });
      Composite.add(engine.world, joint);
      drag = { index, pointer: e.pointerId, joint };
      el.dataset.dragging = 'true';
      wake();
    }, { signal: abort.signal });
    el.addEventListener('pointermove', e => {
      if (drag?.pointer !== e.pointerId || drag.index !== index) return;
      drag.joint.pointA = { x: clamp(e.clientX, left + 12, right - 12), y: clamp(e.clientY + scrollY, 20, floor - 20) };
      wake();
    }, { signal: abort.signal });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(event, release, { signal: abort.signal });
    el.addEventListener('keydown', e => {
      const b = bodies.get(index);
      if (!b || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key)) return;
      e.preventDefault(); Sleeping.set(b, false);
      if (reduced.matches) {
        Body.setPosition(b, { x: clamp(b.position.x + (e.key === 'ArrowLeft' ? -24 : e.key === 'ArrowRight' ? 24 : 0), left + el.offsetWidth / 2 + 2, right - el.offsetWidth / 2 - 2), y: clamp(b.position.y + (e.key === 'ArrowDown' ? 24 : -24), 20, floor - el.offsetHeight / 2 - 2) });
        Sleeping.set(b, true); paint(); return;
      }
      Body.setVelocity(b, { x: e.key === 'ArrowLeft' ? -6 : e.key === 'ArrowRight' ? 6 : 0, y: e.key === 'ArrowDown' ? 4 : -8 });
      wake();
    }, { signal: abort.signal });
  });
  function reveal(index: number, source?: { x: number; y: number }) {
    if (bodies.has(index)) return;
    const el = tags[index], w = el.offsetWidth, h = el.offsetHeight;
    const spacing = Math.max(...tags.map(tag => tag.offsetWidth)) + 16;
    const columns = Math.max(1, Math.floor((right - left - 16) / spacing));
    const resting = !source || reduced.matches;
    const x = resting ? left + 8 + w / 2 + (index % columns) * spacing : source.x;
    const y = resting ? floor - h / 2 - 3 - Math.floor(index / columns) * (h + 5) : source.y;
    const b = Bodies.rectangle(clamp(x, left + w / 2 + 4, right - w / 2 - 4), y, w, h,
      { chamfer: { radius: h / 3 }, restitution: .36, friction: .65, frictionAir: .008, sleepThreshold: 65 });
    bodies.set(index, b); Composite.add(engine.world, b);
    if (!resting) {
      Body.setVelocity(b, { x: (index % 2 ? -1 : 1) * (2.5 + index % 3), y: -9 - index % 3 });
      Body.setAngularVelocity(b, (index % 2 ? -1 : 1) * .035);
    }
    el.dataset.revealed = 'true';
    if (reduced.matches) Sleeping.set(b, true);
    paint(); wake();
  }
  function restore(layout: IdentityLayout): number {
    if (layout.length !== tags.length || !layout.every((item) => item === null || (Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.angle)))) return 0;
    layout.forEach((item, index) => {
      if (!item) return;
      const el = tags[index], w = el.offsetWidth, h = el.offsetHeight;
      const x = clamp(left + item.x * (right - left), left + w / 2 + 4, right - w / 2 - 4);
      const y = clamp(floor - item.y * floor, h / 2 + 8, floor - h / 2 - 3);
      const body = Bodies.rectangle(x, y, w, h, { chamfer: { radius: h / 3 }, restitution: .36, friction: .65, frictionAir: .008, sleepThreshold: 65 });
      Body.setAngle(body, item.angle);
      Sleeping.set(body, true);
      bodies.set(index, body);
      frozen.add(index);
      Composite.add(engine.world, body);
      el.dataset.revealed = 'true';
    });
    paint();
    return bodies.size;
  }
  // Keep the static, readable list when scripts are unavailable.
  root.dataset.physics = 'true';
  document.body.append(layer);
  bounds();
  const observer = new ResizeObserver(bounds);
  observer.observe(document.querySelector('main')!);
  window.addEventListener('resize', bounds, { signal: abort.signal });
  document.addEventListener('visibilitychange', wake, { signal: abort.signal });
  return { reveal, restore, snapshot,
    reset() { release(); bodies.forEach(b => Composite.remove(engine.world, b)); bodies.clear(); frozen.clear(); tags.forEach(el => { delete el.dataset.revealed; el.style.transform = ''; }); },
    dispose() { release(); window.clearTimeout(settleTimer); cancelAnimationFrame(frame); abort.abort(); observer.disconnect(); Engine.clear(engine); layer.remove(); }
  };
}
