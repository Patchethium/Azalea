import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

export type WaveFieldOptions = {
  /** Lines from back to front. */
  lines?: number;
  /** Wave height multiplier. */
  amplitude?: number;
  /** Camera height above the field. */
  cameraHeight?: number;
};

const SEGMENTS = 220;
const HALF_WIDTH = 11;
const DEPTH_NEAR = 3.5;
const DEPTH_FAR = -9;
const PARTICLES = 320;

// Shared by lines and particles: layered sines shaped by a slow envelope, so
// the surface swells and rests like speech instead of rippling evenly.
const waveChunk = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform vec2 uPointer;
  uniform float uRipple;

  float waveHeight(vec2 p) {
    float t = uTime;
    float carrier =
      sin(p.x * 0.85 + t * 0.55 + p.y * 1.3) * 0.55 +
      sin(p.x * 2.1 - t * 0.8 + p.y * 0.7) * 0.25 +
      sin(p.x * 4.7 + t * 1.3 + p.y * 2.9) * 0.08;
    float envelope = 0.35 + 0.65 * smoothstep(-0.2, 0.9, sin(p.x * 0.42 - t * 0.35 + p.y * 0.5));
    float pointer = exp(-dot(p - uPointer, p - uPointer) * 0.22) * 0.55 * uRipple;
    return (carrier * envelope + pointer) * uAmplitude;
  }
`;

const lineVertex = /* glsl */ `
  ${waveChunk}
  varying float vHeight;
  varying float vFade;

  void main() {
    vec3 p = position;
    p.y = waveHeight(p.xz);
    vHeight = p.y / max(uAmplitude, 0.001);
    float side = 1.0 - smoothstep(${(HALF_WIDTH * 0.55).toFixed(1)}, ${HALF_WIDTH.toFixed(1)}, abs(p.x));
    float depth = smoothstep(${DEPTH_FAR.toFixed(1)}, ${(DEPTH_FAR + 5).toFixed(1)}, p.z);
    vFade = side * depth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const lineFragment = /* glsl */ `
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform float uOpacity;
  varying float vHeight;
  varying float vFade;

  void main() {
    float crest = smoothstep(-0.35, 0.75, vHeight);
    vec3 color = mix(uLow, uHigh, crest);
    gl_FragColor = vec4(color, uOpacity * vFade * (0.35 + 0.65 * crest));
  }
`;

const pointVertex = /* glsl */ `
  ${waveChunk}
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vFade;

  void main() {
    vec3 p = position;
    // Each particle rises from the surface, fades and starts over.
    float life = fract(aSeed * 7.31 + uTime * (0.04 + 0.05 * aSeed));
    p.y = waveHeight(p.xz) + life * (1.2 + 2.2 * aSeed);
    p.x += sin(uTime * 0.4 + aSeed * 40.0) * 0.25;
    float side = 1.0 - smoothstep(${(HALF_WIDTH * 0.5).toFixed(1)}, ${HALF_WIDTH.toFixed(1)}, abs(p.x));
    vFade = side * sin(life * 3.14159);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = (4.0 + 9.0 * aSeed) * uPixelRatio / -view.z;
  }
`;

const pointFragment = /* glsl */ `
  uniform vec3 uHigh;
  uniform float uOpacity;
  varying float vFade;

  void main() {
    float glow = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(uHigh, glow * glow * vFade * uOpacity);
  }
`;

const lineGeometry = (lines: number) => {
  const positions = new Float32Array(lines * SEGMENTS * 2 * 3);
  let offset = 0;
  for (let line = 0; line < lines; line++) {
    const z = DEPTH_FAR + ((DEPTH_NEAR - DEPTH_FAR) * line) / (lines - 1);
    for (let segment = 0; segment < SEGMENTS; segment++) {
      for (const end of [segment, segment + 1]) {
        positions[offset++] = -HALF_WIDTH + (2 * HALF_WIDTH * end) / SEGMENTS;
        positions[offset++] = 0;
        positions[offset++] = z;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  return geometry;
};

// A fixed pseudo-random sequence, so the particles look the same on every visit.
const scatter = (index: number) => {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const particleGeometry = () => {
  const positions = new Float32Array(PARTICLES * 3);
  const seeds = new Float32Array(PARTICLES);
  for (let index = 0; index < PARTICLES; index++) {
    positions[index * 3] = (scatter(index) * 2 - 1) * HALF_WIDTH;
    positions[index * 3 + 2] =
      DEPTH_FAR + 3 + scatter(index + 0.5) * (DEPTH_NEAR - DEPTH_FAR - 3);
    seeds[index] = scatter(index + 0.25);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  return geometry;
};

/**
 * Draws an animated field of pitch-contour-like lines with drifting
 * particles into `canvas`, colored from the `--wave-*` CSS variables of the
 * current theme. It follows the pointer, renders only while on screen and
 * draws a single still frame for visitors who prefer reduced motion.
 * Returns a cleanup, or null when WebGL is unavailable.
 */
export const startWaveField = (
  canvas: HTMLCanvasElement,
  options: WaveFieldOptions = {},
) => {
  const { lines = 64, amplitude = 1, cameraHeight = 2.4 } = options;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 60);
  const uniforms = {
    uTime: { value: 0 },
    uAmplitude: { value: amplitude },
    uPointer: { value: new Vector2() },
    uRipple: { value: 0 },
    uLow: { value: new Color() },
    uHigh: { value: new Color() },
    uOpacity: { value: 1 },
    uPixelRatio: { value: pixelRatio * 10 },
  };
  const lineMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    transparent: true,
    depthTest: false,
  });
  const pointMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    transparent: true,
    depthTest: false,
  });
  const lineMesh = new LineSegments(lineGeometry(lines), lineMaterial);
  const pointMesh = new Points(particleGeometry(), pointMaterial);
  lineMesh.frustumCulled = false;
  pointMesh.frustumCulled = false;
  scene.add(lineMesh, pointMesh);

  const applyTheme = () => {
    const style = getComputedStyle(canvas);
    uniforms.uLow.value.set(style.getPropertyValue("--wave-low").trim());
    uniforms.uHigh.value.set(style.getPropertyValue("--wave-high").trim());
    uniforms.uOpacity.value = Number(style.getPropertyValue("--wave-opacity"));
    // Glowing lines on dark pages, ink-like lines on light ones.
    const blending = document.documentElement.classList.contains("dark")
      ? AdditiveBlending
      : NormalBlending;
    lineMaterial.blending = blending;
    pointMaterial.blending = blending;
  };
  applyTheme();
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Where the pointer is and where the eased camera and ripple have got to.
  const target = { x: 0, y: 0, active: false };
  const eased = { x: 0, y: 0, ripple: 0 };
  let visible = false;
  let frame = 0;
  let last = performance.now();

  const render = () => {
    camera.position.set(eased.x * 1.2, cameraHeight - eased.y * 0.5, 7.5);
    camera.lookAt(0, 0.2, -1.5);
    // A swell follows the pointer across the field and settles when it leaves.
    uniforms.uPointer.value.set(eased.x * HALF_WIDTH * 0.7, -1.5 + eased.y * 3);
    uniforms.uRipple.value = eased.ripple;
    renderer.render(scene, camera);
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const delta = Math.min(0.05, (now - last) / 1000);
    last = now;
    uniforms.uTime.value += delta;
    const ease = 1 - Math.exp(-delta * 3);
    eased.x += (target.x - eased.x) * ease;
    eased.y += (target.y - eased.y) * ease;
    eased.ripple += ((target.active ? 1 : 0) - eased.ripple) * ease;
    render();
  };

  const setRunning = () => {
    cancelAnimationFrame(frame);
    if (still || !visible || document.hidden) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    // Keep the field's width in view on narrow screens.
    camera.fov = camera.aspect < 1 ? 62 : 42;
    camera.updateProjectionMatrix();
    render();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    setRunning();
  });
  visibilityObserver.observe(canvas);
  document.addEventListener("visibilitychange", setRunning);

  const onPointerMove = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    target.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    target.y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    target.active = Math.abs(target.y) <= 1;
  };
  const onPointerLeave = () => {
    target.active = false;
  };
  if (!still) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
  }

  return () => {
    cancelAnimationFrame(frame);
    themeObserver.disconnect();
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    document.removeEventListener("visibilitychange", setRunning);
    window.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerleave", onPointerLeave);
    lineMesh.geometry.dispose();
    pointMesh.geometry.dispose();
    lineMaterial.dispose();
    pointMaterial.dispose();
    renderer.dispose();
  };
};
