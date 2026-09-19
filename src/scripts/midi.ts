import { getGlobal } from './global';

/**
 * MIDI Bridge
 * ------------------------------------------------------------
 * 真实 MIDI 键盘 → Web MIDI API → Note On / Note Off。
 *
 *   Physical Keyboard → Web MIDI → MidiBridge → PianoEngine
 *                                            └→ MiniLab UI（琴键同步高亮）
 *
 * 几点刻意的选择：
 * - 页面加载时不申请 MIDI 权限，等用户在 Lab 页面第一次交互再申请。
 * - 不支持时只把状态设成 unsupported，不弹任何窗口。
 * - 设备热插拔（statechange）会重新枚举，不需要刷新页面。
 */

export type MidiStatus = 'unsupported' | 'ready' | 'no-device' | 'live';

export type MidiInputInfo = {
  id: string;
  name: string;
};

export type MidiNoteDetail = {
  midi: number;
  velocity: number;
};

export class MidiBridge extends EventTarget {
  private access: MIDIAccess | null = null;
  private status: MidiStatus = 'ready';
  private inputs: MidiInputInfo[] = [];
  private started = false;
  private pending = false;
  private retryTimer = 0;
  private handlers = new Map<string, (event: MIDIMessageEvent) => void>();

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  getStatus(): MidiStatus {
    return this.status;
  }

  getInputs(): MidiInputInfo[] {
    return this.inputs;
  }

  /** 在用户手势里调用。失败只会让状态停在 unsupported，不会抛出去。 */
  async start(): Promise<void> {
    if (this.started || this.pending) return;

    if (!MidiBridge.supported) {
      this.setStatus('unsupported');
      return;
    }

    this.pending = true;
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.access = access;
      // 申请成功之后才算"已经接上"——见下面的 catch
      this.started = true;
      access.addEventListener('statechange', () => this.sync());
      this.sync();
    } catch {
      /*
       * 申请失败**不等于**浏览器不支持。iOS 上拔掉 USB MIDI 设备再插回来时，
       * 旧会话会失效、requestMIDIAccess 会 reject —— 原来这里直接标成 NOT SUPPORTED
       * 并且因为 started 已经置位而锁死，于是"再插回去必须刷新页面"（本人实测）。
       * 现在：说准确一点（no-device），并且允许重试 —— 下一次交互会再调 start()，
       * 另外这里也自己补一次，省得用户还得动一下页面。
       */
      this.setStatus('no-device');
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => void this.start(), 1500);
    } finally {
      this.pending = false;
    }
  }

  dispose(): void {
    for (const [id, handler] of this.handlers) {
      this.findInput(id)?.removeEventListener('midimessage', handler);
    }
    this.handlers.clear();
    this.access = null;
    this.started = false;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
  }

  /** 重新枚举输入设备，并把 midimessage 接上 */
  private sync(): void {
    const access = this.access;
    if (!access) return;

    const inputs: MidiInputInfo[] = [];
    access.inputs.forEach((input) => {
      inputs.push({ id: input.id, name: input.name ?? input.manufacturer ?? input.id });

      const handler = this.handlers.get(input.id);
      if (handler) input.removeEventListener('midimessage', handler);

      const next = (event: MIDIMessageEvent) => this.onMessage(event);
      this.handlers.set(input.id, next);
      input.addEventListener('midimessage', next);
    });

    this.inputs = inputs;
    this.setStatus(inputs.length > 0 ? 'live' : 'no-device');
  }

  private findInput(id: string): MIDIInput | undefined {
    let found: MIDIInput | undefined;
    this.access?.inputs.forEach((input) => {
      if (input.id === id) found = input;
    });
    return found;
  }

  private onMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;

    const command = data[0] & 0xf0;
    const midi = data[1];
    const velocity = data[2];

    // 0x90 且 velocity 0，等于 Note Off（很多键盘都这么发）
    if (command === 0x90 && velocity > 0) {
      this.emit('midi:noteon', { midi, velocity: velocity / 127 });
      return;
    }

    if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      this.emit('midi:noteoff', { midi, velocity: 0 });
    }
  }

  private setStatus(status: MidiStatus): void {
    if (this.status === status && status !== 'live') {
      this.emit('midi:change');
      return;
    }
    this.status = status;
    this.emit('midi:change');
  }

  private emit(name: string, detail?: MidiNoteDetail): void {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

/** 站点级单例：跨页面切换保持同一个实例 */
export function getMidiBridge(): MidiBridge {
  const global = getGlobal();
  global.midi ??= new MidiBridge();
  return global.midi;
}
