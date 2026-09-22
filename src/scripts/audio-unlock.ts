import { getGlobal } from './global';
import { identityPiano, primeIdentityPiano, usesIdentityPiano } from './identity-audio';

/**
 * 全站**唯一**的"音频解锁"入口
 * ------------------------------------------------------------------
 * 浏览器只在"用户手势里"才允许出声（自动播放策略），iOS 还额外要求
 * AudioContext 在手势里被创建 / resume。以前这件事散在三处，各自挂各自的兜底：
 *
 *   · MusicManager 自己挂了一张全局手势清单（pointerdown / keydown / touchstart /
 *     touchmove / wheel / scroll / pointerup）—— 为了"用户动一下就能接上"，
 *     它连 scroll / wheel / touchmove 都算手势；
 *   · `primeIdentityPianoOnFirstGesture()` 另外在 document 上挂 pointerdown / keydown；
 *   · 入场页点击里再调一次 `primeIdentityPiano()`。
 *
 * 结果是同一件事有三条路径、两套监听。现在统一到这里：**手势只认 pointerdown /
 * keydown**，是否真的该响由各自的意图决定（MP3 的 userPaused / About 让位、
 * 夜曲 transport 的 desired），手势本身不等于"要出声"。
 *
 * 三条规矩：
 *   1. 入场页还立着（NEW VISIT 没点"进入"）时**绝不起播**：`initAudioUnlock()` 看到
 *      gated 就直接返回 —— 连"等手势"的监听都不挂；真正那一次手势在入场页里
 *      （`audioUnlock()`，见 entry-gate.ts）。
 *   2. 自动恢复优先：SAME VISIT 刷新后先自己试（`music.init()` / `piano.ensure()` /
 *      transport 的 `desired`），浏览器放行就响，被拒绝就安静等着。
 *   3. 被拒绝才等手势：第一次 pointerdown / keydown 时统一解锁，并且**只恢复"本来
 *      应该播放"的音频**。
 *
 * 这里不做任何 autoplay policy 绕过；也不看播放器 UI、不看元素可见性。
 */

/** 手势只认这两个：指针按下与按键。不监听 scroll / wheel / touchmove。 */
const GESTURES = ['pointerdown', 'keydown'] as const;

/**
 * "显式播放控制"：这两个按钮的 click 处理器自己就会起播（MP3 的 `music.toggle()`、
 * 夜曲的 `transport.start()`），**不需要** document 这一层替它们提前恢复。
 *
 * 为什么排除（历史提交 6326597 定位过的竞争）：`pointerdown` 在 capture 阶段比 `click` 早，
 * 第一次点播放按钮时全局解锁会先把音频恢复成"正在播放"，随后 click 进到播放器自己的
 * toggle 里，toggle 看到已经在播 → 又把它 pause 掉 —— 净效果"第一下没反应、第二下才正常"。
 *
 * 只排除这两个显式播放控件，不是排除整个 button：页面空白处、别的按钮上的
 * pointerdown / keydown 仍然走全局 `unlockAll()`。
 */
const EXPLICIT_AUDIO_CONTROL = '[data-music-toggle], [data-identity-play]';

/** 这次手势本身落在显式播放控件上吗（落在上面就让开，让按钮自己的 click 走完整用户激活链） */
function isExplicitAudioControlGesture(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest(EXPLICIT_AUDIO_CONTROL));
}

let bound = false;

/**
 * 解锁当前该响的音频。三件事各自幂等：建/唤醒那架琴的 AudioContext；
 * 让 MusicManager 按自己的意图恢复（尊重 userPaused 与 About 让位）；
 * 夜曲只在自己"想播"时才接上。
 *
 * `options.retryMusic === false`：**别在这一刻对 MP3 再补一枪**。
 * SAME VISIT 的 boot 里 `music.init()` 自己就会 `attemptStart()`（历史提交 404cf58 的教训：
 * 紧接着再 `retryIfIdle()` 就是同一 tick 连发两次自动启动，两次并发 `el.play()` 互相打断，
 * 先失败的那次还把状态写回 ready）。手势那一路不带这个参数 —— 那时才是真的"补一枪"。
 */
function unlockAll(options: { retryMusic?: boolean } = {}): void {
  const global = getGlobal();

  // 琴：建 / 唤醒 AudioContext（手势之外调用也无害，只是可能仍是 suspended）
  primeIdentityPiano();

  // 琴真的在跑了，夜曲又"想播"却没在播：接上（上下文刚醒时它自己的监听也会接）
  const transport = global.nocturne;
  if (usesIdentityPiano() && identityPiano().isRunning) {
    if (transport?.isDesired() && !transport.isPlaying()) transport.start();
  }

  // MP3：这一条自己判断 userPaused、About 让位与闸门
  if (options.retryMusic !== false) global.music?.retryIfIdle();
}

/**
 * 页面上第一次真实手势就来解锁；只挂一次，一直有效。
 * 不做"成功就摘掉"：iOS 上"这一次手势能不能解锁音频"并不总是成立
 * （入场点击如果同时弹了系统权限框，那一次激活可能就用掉了），
 * 而这条监听本身是幂等的，留着下次手势接着试。
 *
 * `capture: true` 保持不变 —— 改成 bubble 解决不了竞争：`pointerdown` 即使冒泡也仍然发生在
 * `click` 之前；真正的解法是"这次手势落在显式播放控件上就不抢"（见上面那段）。
 */
function bindGestureUnlock(): void {
  if (bound) return;
  bound = true;
  const onGesture = (event: Event): void => {
    // 显式播放按钮自己会在 click 里起播（仍在那次点击的用户激活链里）：这一下全局解锁让开
    if (isExplicitAudioControlGesture(event)) return;
    unlockAll();
  };
  for (const name of GESTURES) {
    document.addEventListener(name, onGesture, { capture: true, passive: true });
  }
}

/**
 * **必须在用户手势里调用**（入场页"进入"）：挂上"等手势"那条，
 * 并且立刻按各自意图解锁一次。入场页在调用它之前已经放开闸门。
 */
export function audioUnlock(): void {
  bindGestureUnlock();
  unlockAll();
}

/**
 * boot 里调用一次：没有入场页这一趟（SAME VISIT 刷新 / 站内换页）先挂好听手势的
 * 解锁、再自己试一次自动恢复。`gated` 为真时什么都不做 —— 那一路由入场页自己负责，
 * 这样音频不会抢在用户"进入"之前出声。
 *
 * 这一趟的 MP3 自动恢复**只发一枪**：`music.init()` 自己会 `attemptStart()`，所以这里给
 * `unlockAll()` 传 `retryMusic: false`（琴与夜曲的恢复照旧）。真被浏览器拦下时也不用担心：
 * 第一次 pointerdown / keydown 会用默认参数再来一次。
 */
export function initAudioUnlock(options: { gated: boolean }): void {
  if (options.gated) return;
  bindGestureUnlock();
  // 先按"这一趟该不该响"发起一次（init 自己会认用户暂停：暂停过就只标状态、不出声）
  getGlobal().music?.init();
  // 再走一遍统一解锁，但不要再对 MP3 补第二枪
  unlockAll({ retryMusic: false });
}
