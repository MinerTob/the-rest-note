// One persistent renderer across ClientRouter navigations. No work in hidden tabs.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let canvas: HTMLCanvasElement | null = null;
let render: ((seconds: number) => void) | null = null;
let frame = 0;
let last = 0;
let elapsed = 0;

function createRipple(target: HTMLCanvasElement): ((seconds: number) => void) | null {
  const gl = target.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  function shader(type: number, source: string): WebGLShader | null {
    const item = gl!.createShader(type);
    if (!item) return null;
    shaders.push(item);
    gl!.shaderSource(item, source); gl!.compileShader(item);
    return gl!.getShaderParameter(item, gl!.COMPILE_STATUS) ? item : null;
  }
  const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}');
  const fragment = shader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec2 size;
    uniform float time;
    uniform vec3 paper, light, shade;
    float water(vec2 p) {
      float d1=length((p-vec2(.82,.12))*vec2(1.,1.45));
      float d2=length((p-vec2(-.15,.32))*vec2(.85,1.25));
      return sin(d1*28.-time*1.65)*.55 + sin(d2*22.-time*1.15)*.3
        + sin(p.x*8.+p.y*6.-time*.45)*.15;
    }
    void main() {
      vec2 uv=gl_FragCoord.xy/size;
      vec2 p=vec2(uv.x*size.x/size.y,uv.y);
      float h=water(p);
      vec2 slope=vec2(water(p+vec2(.004,0.))-h,water(p+vec2(0.,.004))-h)/.004;
      vec3 normal=normalize(vec3(-slope*.065,1.));
      float spec=pow(max(dot(normal,normalize(vec3(-.35,.55,1.))),0.),10.);
      float area=mix(.15,1.,max(1.-smoothstep(.16,.76,uv.y),smoothstep(.55,1.,uv.x)));
      vec3 base=mix(paper,light,uv.y*.24);
      base=mix(base,shade,(h*.5+.5)*.23*area);
      base=mix(base,light,spec*.68*area);
      gl_FragColor=vec4(base,1.);
    }
  `);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) {
    shaders.forEach(s => gl.deleteShader(s));
    if (program) gl.deleteProgram(program);
    return null;
  }
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  shaders.forEach(s => gl.deleteShader(s));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const size = gl.getUniformLocation(program, 'size');
  const time = gl.getUniformLocation(program, 'time');
  const styles = getComputedStyle(document.documentElement);
  for (const [name, token] of [['paper','--ripple-paper'],['light','--ripple-light'],['shade','--ripple-shade']]) {
    const rgb = styles.getPropertyValue(token).trim().split(/\s+/).map(Number);
    gl.uniform3f(gl.getUniformLocation(program, name), rgb[0], rgb[1], rgb[2]);
  }
  target.classList.add('is-ready');
  return (seconds) => {
    const ratio = Math.min(devicePixelRatio || 1, 1.25);
    const width = Math.min(1920, Math.round(innerWidth * ratio));
    const height = Math.round(innerHeight * width / innerWidth);
    if (target.width !== width || target.height !== height) {
      target.width = width; target.height = height; gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(size, width, height); gl.uniform1f(time, seconds);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
}
function tick(now: number): void {
  frame = requestAnimationFrame(tick);
  if (now - last < 1000 / 30) return;
  elapsed += Math.min((now - last) / 1000, .1);
  last = now;
  render?.(elapsed);
}
function syncAtmosphere(): void {
  document.querySelector('.ambient')?.classList.toggle('atmosphere-paused', reduced.matches || document.hidden);
  const target = document.querySelector<HTMLCanvasElement>('.atmosphere__ripples');
  if (target && target !== canvas) {
    canvas = target;
    render = createRipple(target);
    target.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); cancelAnimationFrame(frame); frame = 0; render = null;
      target.classList.remove('is-ready');
    });
    target.addEventListener('webglcontextrestored', () => { render = createRipple(target); syncAtmosphere(); });
  }
  cancelAnimationFrame(frame); frame = 0;
  if (!document.hidden && document.documentElement.dataset.theme !== 'baroque') {
    render?.(elapsed);
    if (!reduced.matches && render) { last = performance.now(); frame = requestAnimationFrame(tick); }
  }
}
new MutationObserver(syncAtmosphere).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.addEventListener('visibilitychange', syncAtmosphere);
document.addEventListener('astro:page-load', syncAtmosphere);
window.addEventListener('resize', syncAtmosphere, { passive: true });
reduced.addEventListener('change', syncAtmosphere);
syncAtmosphere();
