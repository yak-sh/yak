// The vale as a three.js scene: the ground and everything standing on it in
// chunks, the lake, the sky, and the light that moves across it through the
// day. Built once; `tick` moves the sun and the water.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { CHUNK, groundChunk } from './ground.ts'
import { out } from './mesh.ts'
import { model, place } from './props.ts'
import { lerp, smooth } from './rand.ts'
import { geometry, soft } from './soft.ts'
import { N, type Prop, V, type Vale, WATER } from './terrain.ts'

export type World = {
  scene: THREE.Scene
  sun: THREE.DirectionalLight
  /** what the shadows follow */
  focus: THREE.Vector3
  /** the fire's glow, strongest at night */
  fire: THREE.PointLight
  /** 0 at midnight, 0.5 at noon */
  day: number
  tick: (t: number, dt: number) => void
}

// What is too small to matter far off, or to cast a shadow.
let DECOR = new Set(['flower', 'tuft', 'mushroom'])
// How near a chunk's middle must be for its flowers and grass to be drawn.
let NEAR = 52

/** How long a day lasts, in seconds. */
export let DAY = 20 * 60

// The light through the day: sky overhead, the horizon and fog, the sun's
// colour and strength, and the fill from the sky.
type Look = { top: number; low: number; sun: number; lux: number; fill: number }
let LOOKS: [number, Look][] = [
  [0.0, { top: 0x16284f, low: 0x34507e, sun: 0xa8b8ff, lux: 0.6, fill: 0.8 }],
  [0.22, {
    top: 0x21366a,
    low: 0x465c8c,
    sun: 0xb0c0ff,
    lux: 0.65,
    fill: 0.85,
  }],
  [0.27, { top: 0x5a7ec2, low: 0xf2b27a, sun: 0xffb27a, lux: 1.2, fill: 0.7 }],
  [0.34, { top: 0x5fa8e6, low: 0xcfe6f2, sun: 0xfff1d6, lux: 2.4, fill: 1.0 }],
  [0.5, { top: 0x4f9fe8, low: 0xd8eef6, sun: 0xfff6e2, lux: 2.7, fill: 1.05 }],
  [0.66, { top: 0x5fa0de, low: 0xd6e6ea, sun: 0xffe7c2, lux: 2.4, fill: 1.0 }],
  [0.73, { top: 0x4c6bb0, low: 0xf6a26a, sun: 0xff9a5c, lux: 1.3, fill: 0.7 }],
  [0.78, {
    top: 0x21366a,
    low: 0x564c7c,
    sun: 0xb0c0ff,
    lux: 0.65,
    fill: 0.85,
  }],
  [1.0, { top: 0x16284f, low: 0x34507e, sun: 0xa8b8ff, lux: 0.6, fill: 0.8 }],
]

let mixHex = (a: number, b: number, t: number) =>
  new THREE.Color(a).lerp(new THREE.Color(b), t)

let look = (d: number) => {
  let i = LOOKS.findIndex(([at]) => at > d)
  let [a, la] = LOOKS[Math.max(0, i - 1)], [b, lb] = LOOKS[i]
  let t = smooth(0, 1, (d - a) / (b - a))
  return {
    top: mixHex(la.top, lb.top, t),
    low: mixHex(la.low, lb.low, t),
    sun: mixHex(la.sun, lb.sun, t),
    lux: lerp(la.lux, lb.lux, t),
    fill: lerp(la.fill, lb.fill, t),
  }
}

let SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  gl_Position.z = gl_Position.w;
}`

let SKY_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 low;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float night;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  float h = clamp(vDir.y, -1., 1.);
  vec3 c = mix(low, top, smoothstep(-.02, .55, h));
  float s = max(dot(vDir, sunDir), 0.);
  c += sunColor * (pow(s, 900.) * 3. + pow(s, 12.) * .25);
  vec3 cell = floor(vDir * 160.);
  float star = step(.9975, hash(cell)) * smoothstep(.05, .3, h) * night;
  c += vec3(star);
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

let WATER_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
uniform float time;
uniform vec3 deep;
uniform vec3 shallow;
uniform vec3 sunDir;
uniform vec3 sunColor;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz;
  float w = sin(p.x * 1.7 + time * 1.3) * .5 + sin(p.y * 2.1 - time * 1.1) * .5
    + sin((p.x + p.y) * 3.3 + time * 2.) * .25;
  vec3 n = normalize(vec3(cos(p.x * 1.7 + time * 1.3) * .08, 1., cos(p.y * 2.1 - time * 1.1) * .08));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1. - max(dot(view, n), 0.), 3.);
  vec3 c = mix(shallow, deep, .55 + w * .06);
  c = mix(c, vec3(.85, .93, 1.), fres * .5);
  vec3 h = normalize(view + sunDir);
  c += sunColor * pow(max(dot(n, h), 0.), 180.) * 1.5;
  gl_FragColor = vec4(c, .78 + fres * .15);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`

let WATER_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`

/** Build the vale's scene. `chunks` says which chunks to build, all by default:
 * a page builds the ones near the player first. */
export let world = (v: Vale): World => {
  let scene = new THREE.Scene()
  let size = N * V
  let fog = new THREE.Fog(0xcfe6f2, 40, 110)
  scene.fog = fog

  let ground = soft({ speckle: 0.1 })
  let byChunk = new Map<number, Prop[]>()
  let per = N / CHUNK
  for (let p of v.props) {
    let c = Math.floor(p.i / CHUNK) + Math.floor(p.k / CHUNK) * per
    if (!byChunk.has(c)) byChunk.set(c, [])
    byChunk.get(c)!.push(p)
  }
  // Each chunk is two meshes: the ground and what stands on it, which cast
  // shadows, and the flowers and grass, which are only drawn near the player.
  let decor: { mesh: THREE.Mesh; x: number; z: number }[] = []
  for (let ck = 0; ck < per; ck++) {
    for (let ci = 0; ci < per; ci++) {
      let o = groundChunk(v, ci, ck, out())
      let small = out()
      for (let p of byChunk.get(ci + ck * per) ?? []) {
        let h = v.h[p.i + p.k * N]
        place(DECOR.has(p.kind) ? small : o, model(p.kind, p.seed), [
          (p.i + 0.5) * V,
          h * V,
          (p.k + 0.5) * V,
        ])
      }
      let mesh = new THREE.Mesh(geometry(o), ground)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      scene.add(mesh)
      if (!small.idx.length) continue
      let bits = new THREE.Mesh(geometry(small), ground)
      bits.receiveShadow = true
      bits.matrixAutoUpdate = false
      scene.add(bits)
      decor.push({
        mesh: bits,
        x: (ci + 0.5) * CHUNK * V,
        z: (ck + 0.5) * CHUNK * V,
      })
    }
  }

  // The lake: one plane at the water line, drawn over the ground beneath it.
  let waterMat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        deep: { value: new THREE.Color(0x2f7fa6) },
        shallow: { value: new THREE.Color(0x5fb8cf) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(1, 1, 1) },
      },
    ]),
  })
  let water = new THREE.Mesh(new THREE.PlaneGeometry(size, size), waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set(size / 2, WATER, size / 2)
  scene.add(water)

  // The sky: a dome that follows the camera, with the sun and, at night, stars.
  let skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color() },
      low: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color() },
      night: { value: 0 },
    },
  })
  let sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), skyMat)
  sky.frustumCulled = false
  sky.renderOrder = -1
  scene.add(sky)

  let hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6b7f4a, 1)
  scene.add(hemi)
  let sun = new THREE.DirectionalLight(0xffffff, 2.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  let cam = sun.shadow.camera
  cam.left = cam.bottom = -30
  cam.right = cam.top = 30
  cam.near = 1
  cam.far = 160
  scene.add(sun, sun.target)

  let fire = new THREE.PointLight(0xffa04a, 0, 18, 1.6)
  fire.position.set(64.25, 7.6, 64.25)
  scene.add(fire)

  let focus = new THREE.Vector3(size / 2, 6, size / 2)
  let w: World = {
    scene,
    sun,
    focus,
    fire,
    day: 0.4,
    tick: (t, _dt) => {
      let d = ((t / DAY) + 0.36) % 1
      w.day = d
      let l = look(d)
      // The sun climbs in the east and sets in the west; at night the moon
      // takes its place, lower and bluer.
      let up = d > 0.25 && d < 0.75
      let a = up ? (d - 0.25) / 0.5 * Math.PI : ((d + 0.25) % 1) / 0.5 * Math.PI
      let dir = new THREE.Vector3(
        Math.cos(a),
        Math.sin(a) * (up ? 1 : 0.7),
        0.35,
      )
        .normalize()
      sun.position.copy(focus).addScaledVector(dir, 80)
      sun.target.position.copy(focus)
      sun.color.copy(l.sun)
      sun.intensity = l.lux * Math.min(1, Math.sin(a) * 3 + 0.15)
      hemi.intensity = l.fill
      hemi.color.copy(l.top).lerp(new THREE.Color(0xffffff), 0.5)
      skyMat.uniforms.top.value.copy(l.top)
      skyMat.uniforms.low.value.copy(l.low)
      skyMat.uniforms.sunDir.value.copy(dir)
      skyMat.uniforms.sunColor.value.copy(l.sun).multiplyScalar(up ? 1 : 0.4)
      skyMat.uniforms.night.value = smooth(0.24, 0.18, d) +
        smooth(0.76, 0.82, d)
      fog.color.copy(l.low)
      waterMat.uniforms.time.value = t
      waterMat.uniforms.sunDir.value.copy(dir)
      waterMat.uniforms.sunColor.value.copy(l.sun).multiplyScalar(l.lux / 2.7)
      fire.intensity = 14 + 26 * skyMat.uniforms.night.value +
        Math.sin(t * 9) * 2 + Math.sin(t * 23) * 1.2
      sky.position.copy(focus)
      for (let d of decor) {
        d.mesh.visible = Math.hypot(d.x - focus.x, d.z - focus.z) < NEAR
      }
    },
  }
  return w
}
