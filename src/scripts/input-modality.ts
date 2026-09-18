/**
 * 焦点圈的开关：只有"最近一次操作来自键盘"时才画 :focus-visible。
 *
 * 浏览器自己的启发式不够用 —— 脚本调用 focus() 时（入场页把焦点交给按钮和 main、
 * 身份标签按下时聚焦），Chromium 会把元素判成"键盘焦点"，于是鼠标玩家也会看到
 * 一圈 accent 蓝边（#4A6EE0）。这里把最近一次输入方式记在 <html data-input="…">，
 * 样式里给所有焦点框加同一道门槛（见 src/styles/global.css 与 IdentityStage.astro）。
 */
let modality: 'keyboard' | 'pointer' = 'pointer';
let listening = false;

function apply(): void {
  document.documentElement.dataset.input = modality;
}

export function trackInputModality(): void {
  // 换页会换掉整个 <html>，所以每次 boot() 都要把当前状态重新写上。
  apply();
  if (listening) return;
  listening = true;

  // 默认（还没有任何输入时）按鼠标处理：脚本聚焦不画圈；按下 Tab 或任意按键后才会画。
  document.addEventListener(
    'pointerdown',
    () => {
      modality = 'pointer';
      apply();
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    'keydown',
    () => {
      modality = 'keyboard';
      apply();
    },
    { capture: true },
  );
}
