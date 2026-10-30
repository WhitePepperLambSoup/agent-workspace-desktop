import type { AppearancePalette } from '../design/appearance'

export const LIQUID_OPTICAL_PROFILE = Object.freeze({
  causticGain: 0.34,
})

const VERTEX_SHADER = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 vUv;

void main() {
  vec2 position = POSITIONS[gl_VertexID];
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uIntensity;
uniform bool uDesktopTransparent;
uniform vec3 uEdgeA;
uniform vec3 uEdgeB;
// The field's colour ramp, darkest end first, and the colour of its contour lines.
uniform vec3 uRamp0;
uniform vec3 uRamp1;
uniform vec3 uRamp2;
uniform vec3 uRamp3;
uniform vec3 uInk;
uniform float uVignette;
// Contour hairlines (0 = none): refracting glass shows its bend on them.
uniform float uContours;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 rotate = mat2(0.80, 0.60, -0.60, 0.80);
  for (int octave = 0; octave < 3; octave++) {
    value += amplitude * valueNoise(p);
    p = rotate * p * 2.03 + 11.7;
    amplitude *= 0.48;
  }
  return value;
}

float movingBlob(vec2 p, vec2 center, vec2 radius, float time, float phase) {
  vec2 orbit = vec2(
    sin(time * 0.42 + phase) * 0.26,
    cos(time * 0.34 + phase * 1.7) * 0.20
  );
  vec2 delta = (p - center - orbit) / radius;
  return exp(-dot(delta, delta) * 1.7);
}

float grain(vec2 pixel, float time) {
  return (hash21(pixel + floor(time * 18.0)) - 0.5) * 0.018;
}

vec2 gradientHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gradientNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(dot(gradientHash(i), f), dot(gradientHash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(gradientHash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(gradientHash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float warpedFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int octave = 0; octave < 3; octave++) {
    value += amplitude * gradientNoise(p);
    p = turn * p;
    amplitude *= 0.48;
  }
  return value;
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  vec3 color = mix(uRamp0, uRamp1, smoothstep(0.0, 1.0, t));
  color = mix(color, uRamp2, smoothstep(1.0, 2.0, t));
  return mix(color, uRamp3, smoothstep(2.0, 3.0, t));
}

// Broad regions of colour that drift slowly, with contour hairlines: large shapes with edges
// survive the panes' blur, so the glass has something to bend.
vec3 field(vec2 pixel, float time) {
  float size = min(uResolution.x, uResolution.y);
  vec2 p = (pixel - 0.5 * uResolution) / max(size, 1.0) * 0.85;
  vec2 q = vec2(warpedFbm(p + vec2(time * 0.021, 0.0)), warpedFbm(p + vec2(5.2, 1.3) - vec2(0.0, time * 0.017)));
  vec2 r = vec2(
    warpedFbm(p + 1.25 * q + vec2(1.7, 9.2) + time * 0.013),
    warpedFbm(p + 1.25 * q + vec2(8.3, 2.8) - time * 0.011)
  );
  float height = clamp(warpedFbm(p + 1.4 * r) * 1.45 + 0.5, 0.0, 1.0);
  // Intensity flattens the ramp toward its middle.
  float spread = clamp(0.45 + uIntensity * 1.1, 0.0, 1.0);
  vec3 color = ramp(mix(0.42, height, spread));
  color = mix(color, uRamp3, smoothstep(0.2, 0.7, length(q)) * 0.14 * spread);
  if (uContours > 0.0) {
    float level = height * 14.0;
    float width = fwidth(level);
    float distanceToLine = min(fract(level), 1.0 - fract(level));
    float line = 1.0 - smoothstep(width * 0.35, width * 1.35, distanceToLine);
    color = mix(color, uInk, line * 0.09 * uContours);
  }
  vec2 centered = (vUv - 0.5) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
  color = mix(color, uRamp0 * 0.55, smoothstep(0.3, 1.25, length(centered)) * uVignette);
  return color + grain(pixel, time) * 0.6;
}

void main() {
  if (!uDesktopTransparent) {
    outColor = vec4(clamp(field(gl_FragCoord.xy, uTime + 40.0), 0.0, 1.0), 1.0);
    return;
  }
  vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
  vec2 p = (vUv - 0.5) * aspect * 1.72;
  float time = uTime;

  vec2 drift = vec2(time * 0.090, -time * 0.068);
  vec2 warp = vec2(
    fbm(p * 0.72 + drift),
    fbm(p * 0.66 + vec2(3.7, -1.4) + drift.yx)
  ) - 0.5;
  vec2 refracted = p * 1.13 + warp * 1.65;
  float field = fbm(refracted);
  float shiftedField = fbm(refracted + vec2(0.062, -0.044));

  float fold = abs(field * 2.0 - 1.0);
  float caustic = pow(clamp(1.0 - fold, 0.0, 1.0), 5.0) * ${LIQUID_OPTICAL_PROFILE.causticGain.toFixed(3)};
  float fieldDelta = abs(field - shiftedField);
  float ridge = smoothstep(0.006, 0.036, fieldDelta) * (1.0 - smoothstep(0.052, 0.115, fieldDelta));

  // Long bands provide the broad highlights seen in iOS Control Center;
  // blobs stop the field from collapsing into uniform film grain.
  float bands = 0.5 + 0.5 * sin(
    p.x * 2.4 + p.y * 1.7 + field * 4.4 + time * 0.28
  );
  bands = smoothstep(0.56, 0.92, bands);
  float blobBlue = movingBlob(p, vec2(0.62, -0.12), vec2(0.62, 0.82), time, 0.4);
  float blobRose = movingBlob(p, vec2(-0.52, 0.20), vec2(0.56, 0.66), time, 2.6);
  float blobCyan = movingBlob(p, vec2(0.05, 0.64), vec2(0.42, 0.58), time, 4.7);
  float blueRim = smoothstep(0.18, 0.46, blobBlue) - smoothstep(0.46, 0.68, blobBlue);
  float roseRim = smoothstep(0.16, 0.40, blobRose) - smoothstep(0.40, 0.64, blobRose);
  float cyanRim = smoothstep(0.14, 0.38, blobCyan) - smoothstep(0.38, 0.60, blobCyan);
  float diagonalRose = smoothstep(0.62, 0.90, 0.5 + 0.5 * sin(p.x * 2.15 - p.y * 1.35 + field * 5.2 + time * 0.14));
  float diagonalCyan = smoothstep(0.66, 0.94, 0.5 + 0.5 * sin(p.x * 1.45 + p.y * 2.35 - shiftedField * 4.8 - time * 0.26));

  float edgeDistance = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float fresnel = pow(clamp(1.0 - smoothstep(0.04, 0.28, edgeDistance), 0.0, 1.0), 1.8);
  float sheen = pow(clamp(1.0 - abs(dot(normalize(vec2(0.72, 0.44)), normalize(p + vec2(0.001)))), 0.0, 1.0), 7.0);

  vec3 fluidTint = mix(uEdgeA, uEdgeB, smoothstep(0.20, 0.82, field));
  fluidTint += vec3(0.18, 0.06, 0.28) * blobRose;
  fluidTint += vec3(0.04, 0.18, 0.32) * blobBlue;
  fluidTint += vec3(0.05, 0.30, 0.20) * blobCyan;

  // Render only moving colored highlights over the native desktop blur.
  // The opaque base belongs to the ordinary liquid theme, not this film.
  float highlights = clamp(
    bands * 0.42 + ridge * 0.42 + blueRim * 0.36 + roseRim * 0.36 +
    cyanRim * 0.40 + diagonalRose * 0.30 + diagonalCyan * 0.25 +
    fresnel * 0.26 + sheen * 0.30 + caustic * 0.75,
    0.0, 1.0
  );
  vec3 lightField = mix(fluidTint, vec3(1.0, 0.96, 1.0), clamp(0.18 + caustic * 1.3 + ridge * 0.45 + sheen * 0.35, 0.0, 1.0));
  float localShine = smoothstep(0.16, 0.92, highlights);
  float strength = pow(clamp(uIntensity, 0.0, 1.0), 0.35);
  float alpha = clamp(0.02 + 0.22 * localShine * strength, 0.02, 0.24);
  outColor = vec4(clamp(lightField, 0.0, 1.0), alpha);
}
`

const PALETTE_COLORS: Record<
  AppearancePalette,
  { edgeA: readonly [number, number, number]; edgeB: readonly [number, number, number] }
> = {
  polar: { edgeA: [0.05, 0.72, 0.78], edgeB: [0.27, 0.25, 0.68] },
  verdigris: { edgeA: [0.22, 0.66, 0.57], edgeB: [0.58, 0.55, 0.34] },
  amethyst: { edgeA: [0.55, 0.39, 0.69], edgeB: [0.32, 0.58, 0.61] },
  cobalt: { edgeA: [0.25, 0.49, 0.78], edgeB: [0.30, 0.66, 0.61] },
  garnet: { edgeA: [0.72, 0.31, 0.39], edgeB: [0.42, 0.55, 0.62] },
}

type Rgb = readonly [number, number, number]

function hex(value: string): Rgb {
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255) as unknown as Rgb
}

/** The field's ramp per palette: deep ground, two mid tones, then the far colour. The field drifts
 * under text, so every colour on it, seen through a pane (52% canvas in dark, 76% white in light,
 * reference.css), keeps the palette's muted text above 4.5:1 with room for the light fills of
 * controls on the pane: dark ramps get their colour from saturation rather than lightness, light
 * ramps run pale → a soft middle → white. */
const RAMPS: Record<'dark' | 'light', Record<AppearancePalette, readonly [string, string, string, string]>> = {
  dark: {
    polar: ['#050d18', '#10304f', '#197583', '#5b439e'],
    verdigris: ['#060c0b', '#0e2b21', '#185641', '#55410f'],
    amethyst: ['#0a0712', '#251440', '#5c368b', '#1c6470'],
    cobalt: ['#040a16', '#071438', '#112770', '#082f3d'],
    garnet: ['#0f0609', '#240911', '#571022', '#122539'],
  },
  light: {
    polar: ['#dde7f1', '#bad2e4', '#82aac9', '#f9fbfd'],
    verdigris: ['#e0ebe4', '#c2dacc', '#89b4a2', '#fafcf9'],
    amethyst: ['#eae3f2', '#cdbce2', '#9579b9', '#fbf9fd'],
    cobalt: ['#dee6f3', '#d1dcef', '#a7b9dd', '#fbfcfe'],
    garnet: ['#f1e3e5', '#e4bfc5', '#bb7883', '#fdf9f9'],
  },
}

const LIGHT_PALETTE_COLORS: Record<
  AppearancePalette,
  { edgeA: readonly [number, number, number]; edgeB: readonly [number, number, number] }
> = {
  polar: { edgeA: [0.04, 0.62, 0.98], edgeB: [0.94, 0.22, 0.68] },
  verdigris: { edgeA: [0.04, 0.74, 0.56], edgeB: [0.94, 0.66, 0.12] },
  amethyst: { edgeA: [0.78, 0.26, 0.98], edgeB: [0.08, 0.74, 0.82] },
  cobalt: { edgeA: [0.06, 0.44, 1.00], edgeB: [0.06, 0.82, 0.74] },
  garnet: { edgeA: [1.00, 0.18, 0.34], edgeB: [0.08, 0.60, 0.86] },
}

export interface LiquidShaderRenderer {
  resize(width: number, height: number): void
  render(seconds: number): void
  dispose(): void
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('liquid_shader_create_failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const details = gl.getShaderInfoLog(shader) ?? 'unknown shader error'
    gl.deleteShader(shader)
    throw new Error(`liquid_shader_compile_failed: ${details}`)
  }
  return shader
}

export function createLiquidRenderer(
  canvas: HTMLCanvasElement,
  palette: AppearancePalette,
  intensity: number,
  colorMode: 'dark' | 'light' = 'dark',
  desktopTransparent = false,
  contours = 0,
): LiquidShaderRenderer {
  const gl = canvas.getContext('webgl2', {
    // Context attributes are fixed at creation, including during live toggles.
    alpha: true,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: true,
    powerPreference: 'low-power',
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false,
  })
  if (!gl) throw new Error('webgl2_unavailable')

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) throw new Error('liquid_program_create_failed')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const details = gl.getProgramInfoLog(program) ?? 'unknown link error'
    gl.deleteProgram(program)
    throw new Error(`liquid_program_link_failed: ${details}`)
  }

  const vertexArray = gl.createVertexArray()
  const resolution = gl.getUniformLocation(program, 'uResolution')
  const time = gl.getUniformLocation(program, 'uTime')
  const intensityLocation = gl.getUniformLocation(program, 'uIntensity')
  const desktopTransparency = gl.getUniformLocation(program, 'uDesktopTransparent')
  const edgeA = gl.getUniformLocation(program, 'uEdgeA')
  const edgeB = gl.getUniformLocation(program, 'uEdgeB')
  const contourLocation = gl.getUniformLocation(program, 'uContours')
  const ink = gl.getUniformLocation(program, 'uInk')
  const vignette = gl.getUniformLocation(program, 'uVignette')
  const rampLocations = [0, 1, 2, 3].map((index) => gl.getUniformLocation(program, `uRamp${index}`))
  const colors = colorMode === 'light' ? LIGHT_PALETTE_COLORS[palette] : PALETTE_COLORS[palette]
  const rampColors = RAMPS[colorMode][palette].map(hex)
  const inkColor = colorMode === 'light' ? hex('#0e1b25') : hex('#f4efe6')
  let width = canvas.width
  let height = canvas.height

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      gl.viewport(0, 0, width, height)
    },
    render(seconds) {
      gl.useProgram(program)
      gl.bindVertexArray(vertexArray)
      gl.uniform2f(resolution, width, height)
      gl.uniform1f(time, seconds)
      gl.uniform1f(intensityLocation, intensity)
      gl.uniform1i(desktopTransparency, desktopTransparent ? 1 : 0)
      gl.uniform3fv(edgeA, colors.edgeA)
      gl.uniform3fv(edgeB, colors.edgeB)
      gl.uniform1f(contourLocation, desktopTransparent ? 0 : contours)
      gl.uniform3fv(ink, inkColor)
      gl.uniform1f(vignette, colorMode === 'light' ? 0.18 : 0.5)
      rampLocations.forEach((location, index) => gl.uniform3fv(location, rampColors[index]!))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      gl.deleteVertexArray(vertexArray)
      gl.deleteProgram(program)
    },
  }
}
