// Module runs once; delegation and persisted background survive ClientRouter swaps.
let paused = false;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function syncAtmosphere(): void {
  const still = paused || reduced.matches;
  document.querySelector('.ambient')?.classList.toggle('atmosphere-paused', still || document.hidden);
  document.querySelectorAll<HTMLButtonElement>('[data-atmosphere-toggle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(still));
    button.disabled = reduced.matches;
  });
}

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('[data-atmosphere-toggle]')) return;
  paused = !paused;
  syncAtmosphere();
});
document.addEventListener('visibilitychange', syncAtmosphere);
document.addEventListener('astro:page-load', syncAtmosphere);
reduced.addEventListener('change', syncAtmosphere);
syncAtmosphere();
