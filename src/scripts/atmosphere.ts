// Module runs once; the persisted background survives ClientRouter swaps.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function syncAtmosphere(): void {
  document.querySelector('.ambient')?.classList.toggle('atmosphere-paused', reduced.matches || document.hidden);
}

document.addEventListener('visibilitychange', syncAtmosphere);
document.addEventListener('astro:page-load', syncAtmosphere);
reduced.addEventListener('change', syncAtmosphere);
syncAtmosphere();
