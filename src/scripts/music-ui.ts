import { getTrack } from '@/lib/music';
import { getGlobal } from './global';
import { getDocumentLang, getPreferredLang } from './lang';
import type { MusicManager } from './music-manager';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

/** 把播放器面板和常驻的 MusicManager 绑定起来（支持同页多个面板）。 */
export function initMusicUI(music: MusicManager): void {
  document.querySelectorAll<HTMLElement>('[data-music]').forEach((panel) => {
    const toggle = panel.querySelector<HTMLButtonElement>('[data-music-toggle]');
    const volume = panel.querySelector<HTMLInputElement>('[data-music-volume]');
    const progress = panel.querySelector<HTMLInputElement>('[data-music-progress]');
    let seeking = false;

    if (panel.dataset.ready !== '1') {
      panel.dataset.ready = '1';

      toggle?.addEventListener('click', () => music.toggle());
      volume?.addEventListener('input', () => {
        music.setVolume(Number(volume.value) / 100);
        render();
      });
      const finishSeek = () => {
        if (!progress) return;
        seeking = false;
        render();
      };
      progress?.addEventListener('pointerdown', () => {
        seeking = true;
      });
      progress?.addEventListener('keydown', () => {
        seeking = true;
      });
      progress?.addEventListener('input', () => {
        seeking = true;
        music.seekToRatio(Number(progress.value) / 1000);
        render();
      });
      progress?.addEventListener('change', finishSeek);
      progress?.addEventListener('pointerup', finishSeek);
      progress?.addEventListener('pointercancel', finishSeek);
      progress?.addEventListener('blur', finishSeek);
    }

    const words = {
      ready: panel.dataset.wordReady ?? 'READY',
      active: panel.dataset.wordActive ?? 'ACTIVE',
      paused: panel.dataset.wordPaused ?? 'PAUSED',
      idle: panel.dataset.wordReady ?? 'READY',
      error: panel.dataset.wordReady ?? 'READY',
    };

    render();
    const timer = window.setInterval(render, 260);
    getGlobal().timers.push(timer);

    function render(): void {
      const state = music.getState();
      const lang = getPreferredLang() ?? getDocumentLang();
      const track = getTrack(music.track.id) ?? music.track;

      panel.dataset.state = state;

      const stateEl = panel.querySelector<HTMLElement>('[data-music-state]');
      if (stateEl) stateEl.textContent = words[state];

      const titleEl = panel.querySelector<HTMLElement>('[data-music-title]');
      if (titleEl) titleEl.textContent = track.title;

      const subtitleEl = panel.querySelector<HTMLElement>('[data-music-subtitle]');
      if (subtitleEl) subtitleEl.textContent = track.subtitle?.[lang] ?? track.credit?.[lang] ?? '';

      if (toggle) {
        const showingPause = state === 'active';
        const dataset = toggle.dataset as Record<string, string | undefined>;
        const label = showingPause
          ? lang === 'zh' ? dataset.labelPauseZh ?? '' : dataset.labelPauseEn ?? ''
          : lang === 'zh' ? dataset.labelPlayZh ?? '' : dataset.labelPlayEn ?? '';
        if (label && toggle.getAttribute('aria-label') !== label) {
          toggle.setAttribute('aria-label', label);
        }
        toggle.setAttribute('aria-pressed', state === 'active' ? 'true' : 'false');
      }

      if (volume && document.activeElement !== volume) {
        const value = String(Math.round(music.getVolume() * 100));
        if (volume.value !== value) volume.value = value;
      }

      const { currentTime, duration, ratio } = music.getProgress();
      const displayRatio = progress && seeking ? Number(progress.value) / 1000 : ratio;
      if (progress && !seeking) {
        progress.value = String(Math.round(ratio * 1000));
      }
      progress?.style.setProperty('--progress', `${displayRatio * 100}%`);

      const timeEl = panel.querySelector<HTMLElement>('[data-music-time]');
      if (timeEl) {
        const text = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        if (timeEl.textContent !== text) timeEl.textContent = text;
      }
    }
  });
}
