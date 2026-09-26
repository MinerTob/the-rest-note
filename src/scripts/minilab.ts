import { midiFromKey, noteName } from './notes';
import { PianoEngine } from './piano';
import { KeysSynth } from './synth';
import { getMidiBridge, type MidiStatus } from './midi';
import { getGlobal } from './global';

/**
 * MiniLab
 * ------------------------------------------------------------
 * 25 键的小型 MIDI 控制器。它只负责：
 *   1. 收集输入（鼠标 / 触摸 / 电脑键盘 / 真实 MIDI 键盘）
 *   2. 把音高交给 Piano Sound Engine
 *   3. 更新屏幕读数与琴键状态
 *
 * 它不认识彩蛋。提示高亮只是"收到 egg:hint 就把那个键点亮"，
 * 旋律判断在 Easter Egg Manager 里。
 */

export type MiniLabController = {
  press(midi: number, velocity: number, source: NoteSource): void;
  release(midi: number): void;
  releaseAll(): void;
  dispose(): void;
};

export type NoteSource = 'pointer' | 'keyboard' | 'midi';

/**
 * **必须在用户手势里调用**：把 MiniLab 这架琴的 AudioContext 建起来并开始预载采样。
 *
 * 为什么需要：这架琴的采样原来是从"第一次按琴键"那一刻才开始加载的（同一个手势里），
 * 于是"按键"永远跑在"采样"前面 —— 第一声只能拿合成器顶上，听起来就不是这台钢琴（本人反馈）。
 * 现在入场页点"进入"时就顺手把它预热（那是一次干净的用户手势），走到实验室时采样已经就位，
 * 第一声就是真实采样。只在真的有 MiniLab 的页面上动作，其它页面不受影响。
 */
export function primeMiniLabPiano(options: { preload?: boolean } = {}): void {
  if (!document.querySelector('[data-minilab]')) return;
  getGlobal().piano?.ensure(options);
}

export function initMiniLab(): void {
  const root = document.querySelector<HTMLElement>('[data-minilab]');
  const global = getGlobal();

  bindGlobalInput();

  if (!root) {
    global.minilab = undefined;
    return;
  }

  if (global.minilab && root.dataset.bound === '1') return;

  const piano = (global.piano ??= new PianoEngine());
  const synth = new KeysSynth();
  const midi = getMidiBridge();

  const keyboard = root.querySelector<HTMLElement>('[data-minilab-keys]');
  const keyEls = [...root.querySelectorAll<HTMLButtonElement>('[data-midi]')];
  const modeEl = root.querySelector<HTMLElement>('[data-minilab-mode]');
  const valueEl = root.querySelector<HTMLElement>('[data-minilab-value]');
  const engineEl = root.querySelector<HTMLElement>('[data-minilab-engine]');
  const midiEl = root.querySelector<HTMLElement>('[data-minilab-midi]');
  const midiDotEl = root.querySelector<HTMLElement>('[data-minilab-midi-dot]');
  const words = root.dataset;

  const pressed = new Set<number>();
  const pointerNotes = new Map<number, number>();
  let idleTimer = 0;

  root.dataset.bound = '1';

  const setReadout = (mode: string, value: string) => {
    if (modeEl && modeEl.textContent !== mode) modeEl.textContent = mode;
    if (valueEl && valueEl.textContent !== value) valueEl.textContent = value;
  };

  const keyFor = (midi: number) => keyEls.find((el) => Number(el.dataset.midi) === midi);

  /* ---------------- 输出：屏幕与状态 ---------------- */

  const renderMidi = () => {
    const status: MidiStatus = midi.getStatus();
    const map: Record<MidiStatus, { word: string; dot: string }> = {
      unsupported: { word: words.wordMidiUnsupported ?? 'NOT SUPPORTED', dot: 'dot--idle' },
      ready: { word: words.wordMidiReady ?? 'READY', dot: 'dot--ready' },
      'no-device': { word: words.wordMidiNone ?? 'NO DEVICE', dot: 'dot--ready' },
      live: { word: words.wordMidiLive ?? 'LIVE', dot: 'dot--on dot--pulse' },
    };
    const view = map[status];

    if (midiEl && midiEl.textContent !== view.word) midiEl.textContent = view.word;
    if (midiDotEl && midiDotEl.className !== `dot ${view.dot}`) {
      midiDotEl.className = `dot ${view.dot}`;
    }
  };

  const renderEngine = () => {
    if (!engineEl) return;
    const state = piano.getState();
    const word =
      state === 'ready'
        ? (words.wordEngineReady ?? 'READY')
        : state === 'failed'
          ? (words.wordEngineFailed ?? 'NO SAMPLES')
          : state === 'loading'
            ? (words.wordEngineLoading ?? 'LOADING')
            : (words.wordEngineIdle ?? 'STANDBY');
    if (engineEl.textContent !== word) engineEl.textContent = word;
  };

  /* ---------------- 控制器 ---------------- */

  const controller: MiniLabController = {
    press(midiNote, velocity = 0.85, source) {
      if (pressed.has(midiNote)) return;
      pressed.add(midiNote);

      /*
       * 冷启动（清过缓存 / 第一次来）时采样往往还在下载 —— 这一刻按琴键**必须**有声音，
       * 否则用户看到的就是"点了没反应"，然后关掉页面。所以只要这个音还没有解码好的
       * 采样，就先拿振荡器合成的那台电钢顶上；采样到位之后同一批琴键自然换回采样音色。
       */
      if (piano.getState() === 'failed' || !piano.hasSampleFor(midiNote)) {
        synth.noteOn(midiNote, velocity);
      } else {
        piano.noteOn(midiNote, velocity);
      }

      keyFor(midiNote)?.classList.add('is-on');

      window.clearTimeout(idleTimer);
      setReadout('NOTE', noteName(midiNote));

      window.dispatchEvent(
        new CustomEvent('minilab:note', {
          detail: { midi: midiNote, note: noteName(midiNote), velocity, source },
        }),
      );
    },

    release(midiNote) {
      if (!pressed.has(midiNote)) return;
      pressed.delete(midiNote);

      // 两边都松：没在发声的那一侧本来就是空操作
      synth.noteOff(midiNote);
      piano.noteOff(midiNote);

      keyFor(midiNote)?.classList.remove('is-on');

      // 和 'minilab:note' 对称的松键事件：彩蛋的长按入口靠它判断"某个音松开了"
      window.dispatchEvent(
        new CustomEvent('minilab:release', {
          detail: { midi: midiNote, note: noteName(midiNote) },
        }),
      );

      if (pressed.size === 0) {
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          if (pressed.size === 0) setReadout('MUSIC', words.wordReady ?? 'READY');
        }, 1500);
      }
    },

    releaseAll() {
      [...pressed].forEach((midiNote) => controller.release(midiNote));
      pointerNotes.clear();
    },

    dispose() {
      window.clearTimeout(idleTimer);
      controller.releaseAll();
      synth.allNotesOff();
      piano.allNotesOff();

      window.removeEventListener('egg:hint', onHint as EventListener);
      window.removeEventListener('egg:accept', onAccept as EventListener);
      window.removeEventListener('egg:miss', onMiss as EventListener);
      piano.removeEventListener('piano:state', renderEngine as EventListener);
      piano.removeEventListener('piano:progress', renderEngine as EventListener);
      midi.removeEventListener('midi:change', renderMidi as EventListener);
      midi.removeEventListener('midi:noteon', onMidiNoteOn as EventListener);
      midi.removeEventListener('midi:noteoff', onMidiNoteOff as EventListener);

      root.dataset.bound = '0';
    },
  };

  global.minilab = controller;

  /* ---------------- 彩蛋提示（只做视觉） ---------------- */

  function onHint(event: Event) {
    const detail = (event as CustomEvent<{ note: string | null }>).detail;
    keyEls.forEach((el) => {
      if (el.dataset.note !== detail?.note) el.classList.remove('is-hint');
    });
    if (!detail?.note) return;
    const target = keyEls.find((el) => el.dataset.note === detail.note);
    target?.classList.add('is-hint');
  }

  function onAccept(event: Event) {
    const detail = (event as CustomEvent<{ note: string }>).detail;
    const target = keyEls.find((el) => el.dataset.note === detail?.note);
    if (!target) return;
    target.classList.remove('is-hint');
    target.classList.add('is-accepted');
    window.setTimeout(() => target.classList.remove('is-accepted'), 620);
  }

  function onMiss(event: Event) {
    const detail = (event as CustomEvent<{ note: string | null }>).detail;
    if (!detail?.note) return;
    const target = keyEls.find((el) => el.dataset.note === detail.note);
    if (!target) return;
    target.classList.remove('is-miss');
    void target.offsetWidth;
    target.classList.add('is-miss');
    window.setTimeout(() => target.classList.remove('is-miss'), 560);
  }

  window.addEventListener('egg:hint', onHint as EventListener);
  window.addEventListener('egg:accept', onAccept as EventListener);
  window.addEventListener('egg:miss', onMiss as EventListener);

  /* ---------------- MIDI ---------------- */

  function onMidiNoteOn(event: Event) {
    const detail = (event as CustomEvent<{ midi: number; velocity: number }>).detail;
    if (!detail) return;
    // 只有落在 25 键范围内的音才在网页上高亮与发声
    if (!keyFor(detail.midi)) return;
    controller.press(detail.midi, Math.max(0.25, detail.velocity), 'midi');
  }

  function onMidiNoteOff(event: Event) {
    const detail = (event as CustomEvent<{ midi: number }>).detail;
    if (!detail) return;
    controller.release(detail.midi);
  }

  midi.addEventListener('midi:change', renderMidi as EventListener);
  midi.addEventListener('midi:noteon', onMidiNoteOn as EventListener);
  midi.addEventListener('midi:noteoff', onMidiNoteOff as EventListener);

  piano.addEventListener('piano:state', renderEngine as EventListener);
  piano.addEventListener('piano:progress', renderEngine as EventListener);

  renderMidi();
  renderEngine();

  /*
   * Lab 一加载就向浏览器申请 Web MIDI 权限（`navigator.requestMIDIAccess({ sysex:false })`，
   * 权限完全由浏览器处理）：允许之后实体 MIDI 键盘直接可用，不必先点一下网页模拟琴键。
   * `midi.start()` 自身有 started / pending 幂等保护，所以下面 prime() 里那次再调用也安全
   * —— 它继续作为用户交互时的重试兜底（第一次被拒 / 设备稍后插入都还能再试）。
   */
  void midi.start();

  // 第一次交互：解锁音频（并重试 MIDI 权限）
  let primed = false;
  const prime = () => {
    if (primed) return;
    primed = true;
    piano.ensure();
    void midi.start();
    window.setTimeout(renderEngine, 120);
  };
  root.addEventListener('pointerdown', prime, { passive: true });
  root.addEventListener('keydown', prime);

  /* ---------------- 鼠标 / 触摸 ---------------- */

  if (keyboard) {
    keyboard.addEventListener('pointerdown', (event) => {
      const target = keyFromEvent(event);
      if (!target) return;
      event.preventDefault();
      prime();
      keyboard.setPointerCapture(event.pointerId);
      const midiNote = Number(target.dataset.midi);
      pointerNotes.set(event.pointerId, midiNote);
      controller.press(midiNote, velocityFrom(event, target), 'pointer');
    });

    keyboard.addEventListener('pointermove', (event) => {
      if (!pointerNotes.has(event.pointerId)) return;
      const target = keyFromPoint(event.clientX, event.clientY);
      if (!target) return;
      const midiNote = Number(target.dataset.midi);
      const previous = pointerNotes.get(event.pointerId);
      if (previous === midiNote) return;
      if (previous !== undefined) controller.release(previous);
      pointerNotes.set(event.pointerId, midiNote);
      controller.press(midiNote, velocityFrom(event, target), 'pointer');
    });

    const endPointer = (event: PointerEvent) => {
      const midiNote = pointerNotes.get(event.pointerId);
      if (midiNote === undefined) return;
      pointerNotes.delete(event.pointerId);
      controller.release(midiNote);
    };

    keyboard.addEventListener('pointerup', endPointer);
    keyboard.addEventListener('pointercancel', endPointer);
    keyboard.addEventListener('lostpointercapture', endPointer);
  }

  /* ---------------- 键盘焦点（方向键在琴键之间移动） ---------------- */

  keyEls.forEach((el, index) => {
    el.addEventListener('focus', () => {
      keyEls.forEach((other) => other.setAttribute('tabindex', '-1'));
      el.setAttribute('tabindex', '0');
    });

    el.addEventListener('keydown', (event) => {
      const midiNote = Number(el.dataset.midi);

      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = keyEls[(index + step + keyEls.length) % keyEls.length];
        next.focus();
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) {
          prime();
          controller.press(midiNote, 0.78, 'keyboard');
        }
      }
    });

    el.addEventListener('keyup', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        controller.release(Number(el.dataset.midi));
      }
    });

    el.addEventListener('blur', () => controller.release(Number(el.dataset.midi)));
  });

  function keyFromEvent(event: PointerEvent): HTMLElement | null {
    const target = event.target;
    return target instanceof HTMLElement ? target.closest<HTMLElement>('[data-midi]') : null;
  }

  function keyFromPoint(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y);
    return el instanceof HTMLElement ? el.closest<HTMLElement>('[data-midi]') : null;
  }
}

/** 按在琴键上的位置决定力度：越靠下越重，和真实键盘的手感一致 */
function velocityFrom(event: PointerEvent, key: HTMLElement): number {
  const rect = key.getBoundingClientRect();
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.6;
  return Math.min(0.98, Math.max(0.35, 0.45 + ratio * 0.5));
}

/** 计算机键盘映射：全局只挂一次，永远转发给当前页面的 MiniLab。 */
function bindGlobalInput(): void {
  const global = getGlobal();
  if (global.windowKeysBound) return;
  global.windowKeysBound = true;

  window.addEventListener('keydown', (event) => {
    const controller = global.minilab;
    if (!controller) return;
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.closest('[data-minilab-keys]'))
    ) {
      return;
    }

    const midiNote = midiFromKey(event.key);
    if (midiNote === null) return;
    event.preventDefault();
    global.piano?.ensure();
    void global.midi?.start();
    controller.press(midiNote, 0.78, 'keyboard');
  });

  window.addEventListener('keyup', (event) => {
    const controller = global.minilab;
    if (!controller) return;
    const midiNote = midiFromKey(event.key);
    if (midiNote === null) return;
    controller.release(midiNote);
  });

  window.addEventListener('blur', () => global.minilab?.releaseAll());
}
