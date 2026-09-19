import { Engine, Bodies, Body, Composite, Constraint, Sleeping } from 'matter-js';

/**
 * A document-space playground: scrolling never moves the floor or the bodies.
 * 坐标是**文档像素**，不是归一化比例 —— 换语言时两种页面的舞台高度会差几像素，
 * 归一化坐标会跟着缩放（实测偏 20-80px），像素坐标才是"原位"。
 *
 * `floor` 记的是写下这些落点时地板（`.identity__landing` 下沿）在文档里的位置。
 * 换语言/换宽度之后地板会上下移动（实测首页切语言时整块"关于"区域下沉 115px），
 * 恢复时按地板差值整体平移，标签才继续贴在原来那一块地方，而不是漂出去。
 */
export type IdentityLayout = {
  floor: number;
  items: ({ x: number; y: number; angle: number } | null)[];
};

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
        // 重造本体的时候要是正好在拖它，把拖拽关节接到新本体上；
        // 不接的话关节还挂在已经移出世界的旧本体上 —— 按着指针，标签却一动不动
        // （拖到一半窗口尺寸一变就会踩中，本人反馈的"拖不动"）。
        if (drag?.index === index) drag.joint.bodyB = body;
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
    return {
      floor,
      items: tags.map((_, index) => {
        const body = bodies.get(index);
        if (!body) return null;
        // "本体中心"的文档像素坐标：换语言前后量到多少就是多少，不做任何缩放。
        return { x: body.position.x, y: body.position.y, angle: body.angle };
      }),
    };
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
  /**
   * 手机摇晃彩蛋用：把设备加速度当成一阵"推"灌进场地。
   * x / y 是**屏幕坐标**下、以重力为单位（1 ≈ 9.81m/s²）的加速度，右为正、下为正，
   * 由 identity-motion.ts 从 devicemotion 换算过来。
   *
   * 场上所有的方块都会被推（**包括**从落点记忆里恢复出来的那些）：摇是明确的
   * "让它们动一下"，所以这里顺手解除它们的冻结 —— 恢复出来的方块是 `frozen` 且
   * 不在 `dropped` 里（"先摆出来"的兜底，见 restore()），当初把这两种一起跳过，
   * 结果凡是这一趟进过 About（有落点记忆）的人摇起来毫无反应（本人 iPhone 实测）。
   * 还没上场的标签根本没有本体，自然不会被摇出来。
   *
   * 给的是**冲量（直接改速度）而不是力**：标签躺在地板上（friction .65），
   * 按重力那一档去施力，走一步就被摩擦吃掉，实测只推动 1px —— 看起来就是"摇了没反应"。
   * 冲量是立刻见效的，再叠一点向上的抬升和自转，方块就会真的跳起来翻滚，和外面那阵
   * 晃动对得上（这也和 reveal() 把标签抛出来用的是同一种量级）。
   */
  function shove(x: number, y: number): void {
    if (disposed || reduced.matches) return;
    // 加速度（重力单位）→ 速度增量（px/step）。6 大致等于"晃一下，方块跳几厘米"
    const gain = 6;
    const strength = Math.min(2.5, Math.hypot(x, y));
    bodies.forEach((body, index) => {
      if (drag?.index === index) return;
      frozen.delete(index);
      Sleeping.set(body, false);
      const jitter = (index % 2 ? 1 : -1) * 0.8;
      Body.setVelocity(body, {
        // 越靠边的方块被甩得越远，看起来不像整排同时平移
        x: clamp(body.velocity.x + x * gain + jitter, -16, 16),
        // 略微往上抬：抬离地板才不会被摩擦按死（但不会一路飘走）
        y: clamp(body.velocity.y + y * gain - strength * 0.8, -14, 10),
      });
      if (!body.isStatic) {
        Body.setAngularVelocity(
          body,
          clamp(body.angularVelocity + (index % 2 ? 1 : -1) * strength * 0.06, -0.35, 0.35),
        );
      }
    });
    wake();
  }
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
      // 上一次拖拽要是没收到 pointerup（指针在窗口外松开、被系统弹窗抢走…），
      // 这里先替它收尾 —— 不然 `drag` 会一直卡在"正在拖"，整个实验场谁都拖不动。
      if (drag && performance.now() - drag.startedAt > 2500) release();
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
  // 窗口级的 pointerup / blur 是兜底：元素自己没收到结尾事件时，拖拽也必须结束。
  for (const type of ['pointerup', 'pointercancel', 'blur'] as const)
    window.addEventListener(type, release, { signal: abort.signal });
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
  function restore(layout: IdentityLayout | undefined): number {
    const items = layout?.items;
    if (!layout || !Array.isArray(items) || items.length !== tags.length || !items.every((item) => item === null || (Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.angle)))) return 0;
    // 地板挪了多少，落点就跟着挪多少：换语言之后标签继续贴着同一块区域。
    const shift = Number.isFinite(layout.floor) ? floor - layout.floor : 0;
    items.forEach((item, index) => {
      if (!item) return;
      const el = tags[index], w = el.offsetWidth, h = el.offsetHeight;
      // 存的就是像素坐标，这里只做"别出视口、别陷地板"的松夹取：
      // 一旦按尺寸或舞台宽度去夹，英文那些更宽的标签就会被整排推走（实测偏 75px）。
      const x = clamp(item.x, 8, width - 8);
      const y = clamp(item.y + shift, 8, floor - 4);
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
   * 把此刻场上的标签记成"已经上场"，并从恢复快照的冻结状态接回物理世界。
   *
   * 切语言专用：位置已经原样摆回来了，剩下的空位要留给音乐按原计划一个一个放出来
   * （本人反馈：歌还没播到那一段，十个标签就全弹出来了 —— 就是以前在这里一次补齐的）。
   * restore() 不知道快照是在地面还是半空，所以会先冻结以免普通返回页立刻乱跑；
   * 但切语言是同一次现场的延续，必须解除冻结。否则切换瞬间仍在空中的标签会永久悬停。
   */
  function markPlaced(): void {
    bodies.forEach((body, index) => {
      dropped.add(index);
      frozen.delete(index);
      if (!reduced.matches) Sleeping.set(body, false);
    });
    wake();
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
  return { reveal, restore, markPlaced, snapshot, shove,
    reset() { release(); bodies.forEach(b => Composite.remove(engine.world, b)); bodies.clear(); sizes.clear(); frozen.clear(); dropped.clear(); tags.forEach(el => { delete el.dataset.revealed; el.style.transform = ''; }); },
    dispose() { disposed = true; release(); window.clearTimeout(settleTimer); cancelAnimationFrame(frame); abort.abort(); observer.disconnect(); Engine.clear(engine); layer.remove(); }
  };
}
