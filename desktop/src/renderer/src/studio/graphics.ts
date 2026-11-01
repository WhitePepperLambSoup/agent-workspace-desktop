import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

import type { GraphicsQuality } from '../design/appearance'
import type { Finishes } from './mesh-kit'

export type { GraphicsQuality }

/**
 * The studio's graphics setting. 'standard' is what every computer gets. 'high', which the user
 * turns on, is for a strong graphics card: drawn on the discrete GPU at up to twice the window's
 * pixels, with finer shadows, a room reflected in metal and glass, shade where things meet
 * (ambient occlusion), a glow around lit screens and lamps, and finer models (mesh-kit).
 */

export interface GraphicsProfile {
  powerPreference: WebGLPowerPreference
  /** The most device pixels a CSS pixel is drawn with. */
  maxPixelRatio: number
  shadowMapSize: number
  shadowRadius: number
}

export const GRAPHICS: Record<GraphicsQuality, GraphicsProfile> = {
  standard: { powerPreference: 'low-power', maxPixelRatio: 1.5, shadowMapSize: 2048, shadowRadius: 3 },
  high: { powerPreference: 'high-performance', maxPixelRatio: 2, shadowMapSize: 4096, shadowRadius: 4 },
}

/** Lit surfaces (screens, lamps, stars) are made this much brighter so the glow picks them out; by day the sky in the windows must not glare. */
const GLOW_GAIN = { day: 1.12, night: 1.6 }

/**
 * How strongly each finish reflects the (bright) room around it: metal and glass clearly, satin a
 * little, matte not at all, and less at night, so the lamps and the dark keep their mood. The sky
 * light gives up a little of its share for it.
 */
const REFLECTION: Record<'day' | 'night', Partial<Record<keyof Finishes, number>>> = {
  day: { metal: 0.6, glass: 0.65, satin: 0.2 },
  night: { metal: 0.3, glass: 0.35, satin: 0.12 },
}
export const HIGH_AMBIENT_SHARE = 0.94
/** Shade where things meet: its reach (metres) and strength. */
const AO_RADIUS = 0.55
const AO_BLEND = 0.85
/** Eight samples, smoothed by the pass's denoise, look like sixteen and cost half. */
const AO_SAMPLES = 8
/** The glow: how strong and wide, and how bright a pixel must be to give off any. Softer by day. */
const BLOOM = { day: { strength: 0.18, radius: 0.35, threshold: 1.15 }, night: { strength: 0.38, radius: 0.45, threshold: 1.0 } }
const MSAA_SAMPLES = 4

/**
 * The grade after tone mapping: a gentle S-curve, a little more colour, shadows a touch cooler and
 * highlights a touch warmer. Where the canvas is see-through (the backdrop shows) it is left as it
 * is, so the glow around lamps still falls on the backdrop and nothing tints it.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 0.14 },
    saturation: { value: 1.08 },
    shadows: { value: new THREE.Vector3(-0.012, -0.002, 0.018) },
    highlights: { value: new THREE.Vector3(1.03, 1.005, 0.965) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform vec3 shadows;
    uniform vec3 highlights;
    varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 colour = clamp(source.rgb, 0.0, 1.0);
      colour = mix(colour, colour * colour * (3.0 - 2.0 * colour), contrast);
      float light = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      colour = mix(vec3(light), colour, saturation);
      colour += shadows * (1.0 - light) * (1.0 - light);
      colour *= mix(vec3(1.0), highlights, light * light);
      gl_FragColor = vec4(mix(source.rgb, clamp(colour, 0.0, 1.0), clamp(source.a, 0.0, 1.0)), source.a);
    }`,
}

/** A light from behind and above, cool at night and warm by day, so figures stand off the walls. */
export function rimLight(scene: THREE.Scene, quality: GraphicsQuality | undefined, dark: boolean, centre?: THREE.Vector3): THREE.DirectionalLight | null {
  if (quality !== 'high') return null
  const rim = new THREE.DirectionalLight(dark ? '#9fb6ff' : '#ffe4c4', dark ? 0.7 : 0.55)
  rim.position.set(5, 7, -10).add(centre ?? new THREE.Vector3())
  rim.target.position.copy(centre ?? new THREE.Vector3())
  scene.add(rim, rim.target)
  return rim
}

/** One reflected room per renderer, made the first time a high-quality scene asks. */
const environments = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()

function environmentFor(renderer: THREE.WebGLRenderer): THREE.Texture {
  let texture = environments.get(renderer)
  if (!texture) {
    const generator = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    texture = generator.fromScene(room, 0.04).texture
    room.dispose()
    generator.dispose()
    environments.set(renderer, texture)
  }
  return texture
}

/** Frees the renderer's reflected room; call before disposing a renderer. */
export function releaseEnvironment(renderer: THREE.WebGLRenderer): void {
  environments.get(renderer)?.dispose()
  environments.delete(renderer)
}

/**
 * The finishes for a scene at a quality (before it compiles): in high quality what is lit from
 * within is brighter for the glow, and metal, glass and satin reflect the room around them.
 */
export function dressFinishes(renderer: THREE.WebGLRenderer, finishes: Finishes, quality: GraphicsQuality | undefined, dark: boolean): void {
  if (finishes.glow instanceof THREE.MeshBasicMaterial) finishes.glow.color.setScalar(quality === 'high' ? GLOW_GAIN[dark ? 'night' : 'day'] : 1)
  if (quality !== 'high') return
  const room = environmentFor(renderer)
  for (const [finish, strength] of Object.entries(REFLECTION[dark ? 'night' : 'day']) as Array<[keyof Finishes, number]>) {
    const material = finishes[finish]
    if (!(material instanceof THREE.MeshStandardMaterial)) continue
    material.envMapIntensity = strength
    if (material.envMap === room) continue
    material.envMap = room
    material.needsUpdate = true
  }
}

/** How a scene reaches the screen: straight, or through the high setting's passes. */
export interface Drawing {
  render(): void
  /** Without the passes (a small, blurred picture that would not show them). */
  renderPlain(): void
  /** After the renderer's size or pixel ratio changed (CSS pixels). */
  setSize(width: number, height: number): void
  dispose(): void
}

/**
 * The drawing of a scene at a quality. Standard draws straight to the canvas, as before. High
 * draws into a multisampled half-float picture, shades where things meet, adds the glow, then
 * tone-maps it onto the canvas; the renderer's counts then cover every pass of the frame.
 */
export function createDrawing(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: GraphicsQuality | undefined, dark: boolean): Drawing {
  if (quality !== 'high') {
    const render = (): void => renderer.render(scene, camera)
    return { render, renderPlain: render, setSize: () => undefined, dispose: () => undefined }
  }
  const size = renderer.getSize(new THREE.Vector2())
  const pixels = renderer.getPixelRatio()
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * pixels), Math.max(1, size.y * pixels), { type: THREE.HalfFloatType, samples: MSAA_SAMPLES })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const shade = new GTAOPass(scene, camera, Math.max(1, size.x), Math.max(1, size.y))
  shade.updateGtaoMaterial({ radius: AO_RADIUS, distanceFallOff: 1, thickness: 1, samples: AO_SAMPLES })
  shade.blendIntensity = AO_BLEND
  composer.addPass(shade)
  const bloom = BLOOM[dark ? 'night' : 'day']
  const glow = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x), Math.max(1, size.y)), bloom.strength, bloom.radius, bloom.threshold)
  composer.addPass(glow)
  composer.addPass(new OutputPass())
  const grade = new ShaderPass(GradeShader)
  composer.addPass(grade)
  renderer.info.autoReset = false
  return {
    render() {
      renderer.info.reset()
      composer.render()
    },
    renderPlain() {
      renderer.info.reset()
      renderer.render(scene, camera)
    },
    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(Math.max(1, width), Math.max(1, height))
    },
    dispose() {
      shade.dispose()
      glow.dispose()
      grade.dispose()
      composer.dispose()
      renderer.info.autoReset = true
    },
  }
}
