import type { AppearancePalette } from '../design/appearance'

export const LIQUID_OPTICAL_PROFILE = Object.freeze({
  baseMix: 0.31,
  causticGain: 0.34,
  ridgeGain: 0.13,
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
uniform vec3 uBase;
uniform vec3 uEdgeA;
uniform vec3 uEdgeB;

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

void main() {
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
  float separation = (field - shiftedField) * 0.8;

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

  if (uDesktopTransparent) {
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
    return;
  }

  vec3 chroma = vec3(field + separation, field, field - separation);
  chroma = smoothstep(vec3(0.22), vec3(0.86), chroma);
  vec3 color = mix(uBase, fluidTint, ${LIQUID_OPTICAL_PROFILE.baseMix.toFixed(3)} * uIntensity);
  color += vec3(0.62, 0.10, 0.38) * roseRim * 0.24 * uIntensity;
  color += vec3(0.40, 0.04, 0.30) * smoothstep(0.24, 0.76, blobRose) * 0.16 * uIntensity;
  color += vec3(0.04, 0.18, 0.42) * smoothstep(0.22, 0.76, blobBlue) * 0.17 * uIntensity;
  color += vec3(0.05, 0.52, 0.42) * smoothstep(0.20, 0.72, blobCyan) * 0.28 * uIntensity;
  color += vec3(0.08, 0.25, 0.52) * blueRim * 0.20 * uIntensity;
  color += vec3(0.06, 0.68, 0.56) * cyanRim * 0.27 * uIntensity;
  color += vec3(0.42, 0.10, 0.48) * diagonalRose * 0.18 * uIntensity;
  color += vec3(0.08, 0.28, 0.42) * diagonalCyan * 0.14 * uIntensity;

  // The reference has warm violet pooling at the lower corners and a broad
  // cyan bloom across the upper field. Keep these layers soft and animate
  // their underlying field so the composition never becomes a static gradient.
  float lowerField = smoothstep(0.38, 0.96, 1.0 - vUv.y);
  float lowerCorners = lowerField * (0.38 + 0.62 * smoothstep(0.18, 0.72, abs(vUv.x - 0.5)));
  float upperBloom = smoothstep(0.34, 0.96, vUv.y) * smoothstep(0.08, 0.94, 1.0 - abs(vUv.x - 0.55) * 1.65);
  float warmLowerLeft = lowerField * smoothstep(0.18, 0.86, 1.0 - vUv.x);
  float warmLowerRight = lowerField * smoothstep(0.44, 0.98, vUv.x);
  float coolUpperLeft = smoothstep(0.28, 0.96, 1.0 - vUv.x) * smoothstep(0.24, 0.94, vUv.y);
  color += vec3(0.34, 0.10, 0.44) * lowerCorners * 0.20 * uIntensity;
  color += vec3(0.04, 0.42, 0.36) * upperBloom * 0.30 * uIntensity;
  color += vec3(0.58, 0.27, 0.12) * warmLowerLeft * 0.20 * uIntensity;
  color += vec3(0.84, 0.31, 0.46) * warmLowerRight * 0.50 * uIntensity;
  color += vec3(0.18, 0.24, 0.62) * coolUpperLeft * 0.22 * uIntensity;
  color += chroma * vec3(0.26, 0.16, 0.34) * uIntensity;
  color += (caustic * 0.55 + bands * 0.18 + grain(gl_FragCoord.xy, time)) * uIntensity;
  color += mix(uEdgeB, uEdgeA, chroma) * ridge * ${LIQUID_OPTICAL_PROFILE.ridgeGain.toFixed(3)} * uIntensity;
  color += mix(vec3(0.20, 0.48, 0.85), vec3(0.95, 0.28, 0.62), bands) * fresnel * 0.30 * uIntensity;
  color += vec3(1.0, 0.94, 0.98) * sheen * 0.11 * uIntensity;
  color = pow(max(color, vec3(0.0)), vec3(0.92));
  outColor = vec4(color, 1.0);
}
`

const PALETTE_COLORS: Record<
  AppearancePalette,
  { base: readonly [number, number, number]; edgeA: readonly [number, number, number]; edgeB: readonly [number, number, number] }
> = {
  polar: { base: [0.035, 0.14, 0.29], edgeA: [0.05, 0.72, 0.78], edgeB: [0.27, 0.25, 0.68] },
  verdigris: { base: [0.045, 0.066, 0.067], edgeA: [0.22, 0.66, 0.57], edgeB: [0.58, 0.55, 0.34] },
  amethyst: { base: [0.062, 0.057, 0.077], edgeA: [0.55, 0.39, 0.69], edgeB: [0.32, 0.58, 0.61] },
  cobalt: { base: [0.043, 0.060, 0.082], edgeA: [0.25, 0.49, 0.78], edgeB: [0.30, 0.66, 0.61] },
  garnet: { base: [0.075, 0.052, 0.058], edgeA: [0.72, 0.31, 0.39], edgeB: [0.42, 0.55, 0.62] },
}

const LIGHT_PALETTE_COLORS: Record<
  AppearancePalette,
  { base: readonly [number, number, number]; edgeA: readonly [number, number, number]; edgeB: readonly [number, number, number] }
> = {
  polar: { base: [0.12, 0.20, 0.34], edgeA: [0.04, 0.62, 0.98], edgeB: [0.94, 0.22, 0.68] },
  verdigris: { base: [0.08, 0.24, 0.23], edgeA: [0.04, 0.74, 0.56], edgeB: [0.94, 0.66, 0.12] },
  amethyst: { base: [0.18, 0.10, 0.28], edgeA: [0.78, 0.26, 0.98], edgeB: [0.08, 0.74, 0.82] },
  cobalt: { base: [0.06, 0.15, 0.32], edgeA: [0.06, 0.44, 1.00], edgeB: [0.06, 0.82, 0.74] },
  garnet: { base: [0.28, 0.08, 0.16], edgeA: [1.00, 0.18, 0.34], edgeB: [0.08, 0.60, 0.86] },
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
  const base = gl.getUniformLocation(program, 'uBase')
  const edgeA = gl.getUniformLocation(program, 'uEdgeA')
  const edgeB = gl.getUniformLocation(program, 'uEdgeB')
  const colors = colorMode === 'light' ? LIGHT_PALETTE_COLORS[palette] : PALETTE_COLORS[palette]
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
      gl.uniform3fv(base, colors.base)
      gl.uniform3fv(edgeA, colors.edgeA)
      gl.uniform3fv(edgeB, colors.edgeB)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      gl.deleteVertexArray(vertexArray)
      gl.deleteProgram(program)
    },
  }
}
