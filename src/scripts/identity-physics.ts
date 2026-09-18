import { Engine, Bodies, Body, Composite, Constraint, Sleeping } from 'matter-js';

/**
 * A document-space playground: scrolling never moves the floor or the bodies.
 * 坐标是**文档像素**，不是归一化比例 —— 换语言时两种页面的舞台高度会差几像素，
 * 归一化坐标会跟着缩放（实测偏 20-80px），像素坐标才是"原位"。
 */
export type IdentityLayout = ({ x: number; y: number; angle: number } | null)[];

export function createIdentityPhysics(
  root: HTMLElement,
  tags: HTMLElement[],
  onSettled?: (layout: IdentityLayout) => void,
  /** 点按（不是拖拽）到带 [data-identity-link] 的标签时回调；由调用方决定去哪儿。 */
  onActivate?: (el: HTMLElement) => void,
) {
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.4;
  const layer = root.querySelector<HTMLElement>('[data-identity-arena]')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const bodies = new Map<number, Body>();
  /** 每个本体是按什么尺寸造的：bounds() 靠它发现"元素尺寸变了"。 */
  const sizes = new Map<number, { w: number; h: number }>();
  const frozen = new Set<number>();
  let walls: Body[] = [], width = 0, floor = 0, frame = 0, last = 0, accumulator = 0;
  let disposed = false;
  let left = 0, right = 0;
  let settleTimer = 0;
  let drag: {
    index: number; pointer: number; joint: Constraint;
    fromX: number; fromY: number; moved: number; startedAt: number;
  } | undefined;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const dropped = new Set<number>();
  /** 造一个本体，并记下造它时用的尺寸。 */
  function makeBody(index: number, x: number, y: number, w: number, h: number, angle = 0): Body {
    const body = Bodies.rectangle(x, y, w, h, { chamfer: { radius: h / 3 }, restitution: .36, friction: .65, frictionAir: .008, sleepThreshold: 65 });
    if (angle) Body.setAngle(body, angle);
    sizes.set(index, { w, h });
    return body;
  }
  /** 抬手之后短暂屏蔽浏览器自带的链接点击：拖过了就不该算"点了一下"。 */
  let swallowClickUntil = 0;
  function bounds() {
    if (disposed) return;
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
      const el = tags[index], size = sizes.get(index);
      let body = b;
      // 元素的尺寸变了（样式/字体刚就位、换语言、改窗口）→ 用**同一个中心**重造本体。
      // 脚本刚接手时量到的尺寸常常是错的（实测 46px 的标签量成 134px），
      // 拿它去夹取会把方块顶歪 44px；重造之后尺寸对得上，位置一点没动。
      if (size && (Math.abs(size.w - el.offsetWidth) > .5 || Math.abs(size.h - el.offsetHeight) > .5)) {
        body = makeBody(index, b.position.x, b.position.y, el.offsetWidth, el.offsetHeight, b.angle);
        Body.setVelocity(body, b.velocity);
        Body.setAngularVelocity(body, b.angularVelocity);
        Composite.remove(engine.world, b);
        Composite.add(engine.world, body);
        bodies.set(index, body);
      }
      // 只夹"别出视口、别陷进地板"，而且**不按方块自己的尺寸算** ——
      // 尺寸量错的时候，按尺寸算会连位置一起夹歪（以前的 `floor - 50` 就是把躺好的
      // 方块整体抬起 27px，看本人眼里就是"切语言之后位移"）。
      Body.setPosition(body, {
        x: clamp(body.position.x, 8, width - 8),
        y: clamp(body.position.y, 8, floor - 4),
      });
      Sleeping.set(body, reduced.matches || frozen.has(index));
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
      // "本体中心"的文档像素坐标：换语言前后量到多少就是多少，不做任何缩放。
      return { x: body.position.x, y: body.position.y, angle: body.angle };
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
  function release(event?: Event) {
    if (!drag) return;
    Composite.remove(engine.world, drag.joint);
    const el = tags[drag.index], pointer = drag.pointer;
    // 只有"按下去几乎没动就抬手"才算点按：拖动过、或按住超过 0.7s，都不算。
    const tap = event?.type === 'pointerup' && drag.moved < 8 && performance.now() - drag.startedAt < 700;
    if (!tap) swallowClickUntil = performance.now() + 300;
    drag = undefined;
    el.dataset.dragging = 'false';
    if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
    window.setTimeout(saveWhenSettled, 260);
    wake();
    if (tap && el.dataset.identityLink) onActivate?.(el);
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
      drag = { index, pointer: e.pointerId, joint, fromX: e.clientX, fromY: e.clientY, moved: 0, startedAt: performance.now() };
      el.dataset.dragging = 'true';
      wake();
    }, { signal: abort.signal });
    el.addEventListener('pointermove', e => {
      if (drag?.pointer !== e.pointerId || drag.index !== index) return;
      drag.joint.pointA = { x: clamp(e.clientX, left + 12, right - 12), y: clamp(e.clientY + scrollY, 20, floor - 20) };
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.fromX, e.clientY - drag.fromY));
      wake();
    }, { signal: abort.signal });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(event, release, { signal: abort.signal });
    el.addEventListener('keydown', e => {
      const b = bodies.get(index);
      if (!b || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key)) return;
      e.preventDefault();
      // 链接标签：回车 = 打开它指向的页面；方向键、空格仍然是"抛掷"。
      if (e.key === 'Enter' && el.dataset.identityLink) { onActivate?.(el); return; }
      Sleeping.set(b, false);
      if (reduced.matches) {
        Body.setPosition(b, { x: clamp(b.position.x + (e.key === 'ArrowLeft' ? -24 : e.key === 'ArrowRight' ? 24 : 0), left + el.offsetWidth / 2 + 2, right - el.offsetWidth / 2 - 2), y: clamp(b.position.y + (e.key === 'ArrowDown' ? 24 : -24), 20, floor - el.offsetHeight / 2 - 2) });
        Sleeping.set(b, true); paint(); return;
      }
      Body.setVelocity(b, { x: e.key === 'ArrowLeft' ? -6 : e.key === 'ArrowRight' ? 6 : 0, y: e.key === 'ArrowDown' ? 4 : -8 });
      wake();
    }, { signal: abort.signal });
  });
  // 拖过之后的单击不算点按：在捕获阶段吃掉它，别让 <a> 自己跳页。
  document.addEventListener('click', (event) => {
    if (performance.now() > swallowClickUntil) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-identity-arena] [data-identity-link]')) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, signal: abort.signal });
  function reveal(index: number, source?: { x: number; y: number }) {
    if (dropped.has(index)) return;
    const el = tags[index], w = el.offsetWidth, h = el.offsetHeight;
    // 备用队形只看普通标签：可点击的那个本来就宽得多，用它算间距会把整排挤成单列。
    const plain = tags.filter(tag => !tag.dataset.identityLink);
    const spacing = Math.max(...(plain.length ? plain : tags).map(tag => tag.offsetWidth)) + 16;
    const columns = Math.max(1, Math.floor((right - left - 16) / spacing));
    const resting = !source || reduced.matches;
    const x = resting ? left + 8 + w / 2 + (index % columns) * spacing : source.x;
    const y = resting ? floor - h / 2 - 3 - Math.floor(index / columns) * (h + 5) : source.y;
    const px = clamp(x, left + w / 2 + 4, right - w / 2 - 4);
    let b = bodies.get(index);
    if (b) {
      // 记忆里的落点只是"先摆出来让你看得见"：音乐一响就重新抛回场上，再落一次。
      frozen.delete(index); Sleeping.set(b, false); Body.setAngle(b, 0); Body.setPosition(b, { x: px, y });
    } else {
      b = makeBody(index, px, y, w, h);
      bodies.set(index, b); Composite.add(engine.world, b);
    }
    dropped.add(index);
    // 可点击的那个标签又长又大：让它重一点、别自转 —— 一转起来就变成一根竖着的横幅。
    const linked = Boolean(el.dataset.identityLink);
    if (linked) Body.setInertia(b, b.inertia * 4);
    if (!resting) {
      Body.setVelocity(b, { x: (index % 2 ? -1 : 1) * (2.5 + index % 3), y: -9 - index % 3 });
      if (!linked) Body.setAngularVelocity(b, (index % 2 ? -1 : 1) * .035);
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
      // 存的就是像素坐标，这里只做"别出视口、别陷地板"的松夹取：
      // 一旦按尺寸或舞台宽度去夹，英文那些更宽的标签就会被整排推走（实测偏 75px）。
      const x = clamp(item.x, 8, width - 8);
      const y = clamp(item.y, 8, floor - 4);
      const old = bodies.get(index);
      if (old) Composite.remove(engine.world, old);
      const body = makeBody(index, x, y, w, h, item.angle);
      Sleeping.set(body, true);
      bodies.set(index, body);
      frozen.add(index);
      Composite.add(engine.world, body);
      el.dataset.revealed = 'true';
    });
    paint();
    return bodies.size;
  }
  /**
   * 还没上场的标签直接摆进静止队形（不抛、不滚）。
   * 切语言保留落点时用：落点记录里缺几条就补几条，绝不重排已经躺好的那些。
   */
  function placeMissing() {
    tags.forEach((_, index) => {
      if (bodies.has(index)) return;
      reveal(index);
      const body = bodies.get(index);
      if (!body) return;
      // 补位就位即睡：别让它在队形里再抖一下。
      Sleeping.set(body, true);
      frozen.add(index);
    });
    paint();
  }
  // Keep the static, readable list when scripts are unavailable.
  root.dataset.physics = 'true';
  document.body.append(layer);
  bounds();
  const observer = new ResizeObserver(bounds);
  observer.observe(document.querySelector('main')!);
  window.addEventListener('resize', bounds, { signal: abort.signal });
  document.addEventListener('visibilitychange', wake, { signal: abort.signal });
  // 样式/字体就位后再量一次：脚本刚接手时元素尺寸可能还是错的（换语言最容易撞上），
  // 这一次会让 bounds() 发现尺寸对不上、重造本体 —— 位置不动，只是把尺寸补正。
  void document.fonts?.ready.then(() => { requestAnimationFrame(bounds); });
  return { reveal, restore, placeMissing, snapshot,
    reset() { release(); bodies.forEach(b => Composite.remove(engine.world, b)); bodies.clear(); sizes.clear(); frozen.clear(); dropped.clear(); tags.forEach(el => { delete el.dataset.revealed; el.style.transform = ''; }); },
    dispose() { disposed = true; release(); window.clearTimeout(settleTimer); cancelAnimationFrame(frame); abort.abort(); observer.disconnect(); Engine.clear(engine); layer.remove(); }
  };
}
