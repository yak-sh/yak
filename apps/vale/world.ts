// The world as a three.js scene: ground and props in streamed chunks, shared
// building shapes instanced across them, thinning away where they come
// between the camera and the hero, the roofs and upper floors fading, their
// doors (doors.ts), the water, the sky, the nearest village's fire, the
// lamps, and the light that moves across it all through the day, all in the
// look of the region the focus is in, blended with the next near a border.
// `tick` moves the sun, the water and the flames, and streams the chunks:
// those within sight of the focus are grown and meshed off the page's thread
// (chunks.ts), nearest first and finer the nearer (stream.ts), and those left
// behind are let go, with the lamps and doors of what stands in them. A
// chunk's arrays are let go too once the GPU has them, since nothing on the
// page reads them; the ground a finest chunk was grown from is kept in the
// page's vale, where its walkers read it.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { airOf } from './air.ts'
import type { Glow } from './buildings/kit.ts'
import type { Chunk } from './chunks.ts'
import { doors, type Hung } from './doors.ts'
import { type Fire, flames } from './flames.ts'
import { paletteOf } from './ground.ts'
import { instances } from './instances.ts'
import { LEVELS, type Spot } from './levels.ts'
import type { Packed, Vec } from './mesh.ts'
import { KINDS } from './props.ts'
import { lerp, smooth } from './rand.ts'
import { blend } from './regions.ts'
import { type Building, cutaway } from './solid.ts'
import { cut, CUTS, geometry, night, sight, soft } from './soft.ts'
import { type Want, wanted } from './stream.ts'
import {
  adopt,
  buildingOf,
  CHUNK,
  groundAt,
  hearthNear,
  standAt,
  type Vale,
  WATER,
} from './terrain.ts'

/** How the page meshes chunk (ci, ck) at a detail (stream.ts), off its
 * thread. */
export type Mesher = {
  chunk: (ci: number, ck: number, lod: number) => Promise<Chunk>
  template: (
    kind: string,
    seed: number,
    turn: number,
    near: boolean,
  ) => Promise<Packed>
}

export type World = {
  scene: THREE.Scene
  /** the level's haze: nothing past its far edge is seen */
  fog: THREE.Fog
  sun: THREE.DirectionalLight
  /** what the shadows follow */
  focus: THREE.Vector3
  /** the fire's glow, strongest at night */
  fire: THREE.PointLight
  /** 0 at midnight, 0.5 at noon */
  day: number
  tick: (t: number, dt: number) => void
  /** keep the camera's (`from`) sight of the hero clear: standing at
   * `feet`, `tall` metres tall; and fade the roofs and upper floors over
   * them, and between them and the camera */
  see: (
    from: THREE.Vector3,
    feet: THREE.Vector3,
    tall: number,
    dt?: number,
  ) => void
  /** swing each door open while someone in `near` is near it */
  swing: (near: Vec[], dt: number) => void
  /** once every chunk within FIRST of the focus is drawn, at any detail */
  near: () => Promise<void>
  /** how many chunks within sight are not yet drawn as finely as wanted */
  pending: number
  /** how many chunks are drawn at each detail */
  chunks: number[]
  /** let the GPU go of everything the world drew */
  dispose: () => void
}

// How near a chunk's middle must be for its flowers and grass to be drawn.
let NEAR = 52
// How many chunks are asked for at once: enough to keep every worker busy,
// few enough that the nearest are always asked next.
let ASKED = 8
// How near the focus, in metres, every chunk is drawn before the page shows
// it: the ground a hero stands on and the next few steps round them. The rest
// streams in while they look.
let FIRST = 24
// How near the focus a village's fire burns, in metres.
let HEARTH = 90

// Once the GPU has an array, the page lets it go.
let release = (a: THREE.BufferAttribute) =>
  a.onUpload(() => a.array = a.array.slice(0, 0))

let bytes = (p: Packed) =>
  Object.values(p).reduce((n, a) => n + a.byteLength, 0)

/** How long a day lasts, in seconds. */
export let DAY = 20 * 60

// The light through the day: sky overhead, the horizon and fog, the sun's
// colour and strength, and the fill from the sky.
type Look = { top: number; low: number; sun: number; lux: number; fill: number }
let light = (
  top: number,
  low: number,
  sun: number,
  lux: number,
  fill: number,
): Look => ({ top, low, sun, lux, fill })
let LOOKS: [number, Look][] = [
  [0.0, light(0x0d1936, 0x243660, 0x9fb4ff, 0.45, 0.5)],
  [0.22, light(0x18295a, 0x384e80, 0xa8baff, 0.6, 0.65)],
  [0.27, light(0x5a7ec2, 0xf2b27a, 0xffb27a, 1.2, 0.7)],
  [0.34, light(0x5fa8e6, 0xcfe6f2, 0xfff1d6, 2.4, 1.0)],
  [0.5, light(0x4f9fe8, 0xd8eef6, 0xfff6e2, 2.7, 1.05)],
  [0.66, light(0x5fa0de, 0xd6e6ea, 0xffe7c2, 2.4, 1.0)],
  [0.73, light(0x4c6bb0, 0xf6a26a, 0xff9a5c, 1.3, 0.7)],
  [0.78, light(0x18295a, 0x4a4274, 0xa8baff, 0.6, 0.65)],
  [1.0, light(0x0d1936, 0x243660, 0x9fb4ff, 0.45, 0.5)],
]

// What the sky's light bounces off: grass by day, nothing much by night.
let GRASS = new THREE.Color(0x6b7f4a)
let DARK = new THREE.Color(0x151b2e)

// A round glow, bright in the middle and gone at the edge, drawn once.
let glowTexture = () => {
  let c = document.createElement('canvas')
  c.width = c.height = 64
  let g = c.getContext('2d')!
  let r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,0.9)')
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

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
uniform vec3 sheen;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz;
  float w = sin(p.x * 1.7 + time * 1.3) * .5 + sin(p.y * 2.1 - time * 1.1) * .5
    + sin((p.x + p.y) * 3.3 + time * 2.) * .25;
  vec3 n = normalize(vec3(cos(p.x * 1.7 + time * 1.3) * .08, 1., cos(p.y * 2.1 - time * 1.1) * .08));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1. - max(dot(view, n), 0.), 3.);
  vec3 c = mix(shallow, deep, .55 + w * .06);
  c = mix(c, sheen, fres * .5);
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

/** Build the world's scene, its chunks meshed by `mesh` as the focus comes
 * near them; the ground they were grown from kept in `v`, the page's own. */
export let world = (v: Vale, mesh: Mesher): World => {
  let scene = new THREE.Scene()
  // The look of the region the focus is in, blended with the next near a
  // border (`looks`): its haze, its water, the colour its sky leans to, and
  // what drifts in its air.
  let fog = new THREE.Fog(0xcfe6f2, 40, 110)
  scene.fog = fog

  // Each chunk drawn is two meshes: the ground and what stands on it, which
  // cast shadows, and the flowers and grass, which are drawn only at the
  // finest detail and only near the player; and what glows in it at dusk.
  // Past the fog, nothing is drawn.
  let ground = soft({ speckle: 0.1, see: true })
  let buildings = instances(scene, ground, mesh.template)
  let hanging = doors(scene, ground)
  type Lamp = {
    lantern: THREE.MeshBasicMaterial
    halo: THREE.SpriteMaterial
    box: THREE.Mesh
    sprite: THREE.Sprite
  }
  type Drawn = {
    lod: number
    solid: THREE.Mesh
    small: THREE.Mesh | null
    lamps: Lamp[]
    glows: Glow[]
    doors: Hung
    /** its middle */
    x: number
    z: number
  }
  let drawn = new Map<string, Drawn>()
  let asked = new Set<string>()
  let wants = new Map<string, Want>()
  let waiting: (() => void)[] = []
  let gone = false
  let key = (ci: number, ck: number) => `${ci} ${ck}`

  let meshOf = (p: Chunk['solid'], ci: number, ck: number) => {
    let g = geometry(p)
    g.userData.bytes = bytes(p)
    for (let a of Object.values(g.attributes)) {
      if (a instanceof THREE.BufferAttribute) release(a)
    }
    if (g.index) release(g.index)
    let m = new THREE.Mesh(g, ground)
    m.position.set(ci * CHUNK, 0, ck * CHUNK)
    m.matrixAutoUpdate = false
    m.updateMatrix()
    return m
  }

  // What glows at dusk in a chunk, the village's lamps, a forge's coals and
  // the like: a bright lantern in a round halo.
  let halo = glowTexture()
  let glowsOf = (ci: number, ck: number): Glow[] => {
    let glows: Glow[] = []
    for (let p of v.plant(ci, ck)) {
      let lit = KINDS[p.kind].glow
      if (lit) {
        glows.push({
          ...lit,
          at: [p.x + lit.at[0], standAt(v, p) + lit.at[1], p.z + lit.at[2]],
        })
      }
      let b = buildingOf(v, p)
      if (b) glows.push(...b.glows)
    }
    return glows
  }
  let lampsOf = (glows: Glow[]): Lamp[] =>
    glows.map((lit) => {
      let [x, y, z] = lit.at
      let lantern = new THREE.MeshBasicMaterial({
        color: lit.color ?? 0xffc860,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      let side = lit.size * 0.175
      let box = new THREE.Mesh(lampBox, lantern)
      box.scale.setScalar(side)
      box.position.set(x, y, z)
      let glow = new THREE.SpriteMaterial({
        map: halo,
        color: lit.color ?? 0xffb84a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      let sprite = new THREE.Sprite(glow)
      sprite.position.set(x, y, z)
      sprite.scale.setScalar(lit.size)
      scene.add(box, sprite)
      return { lantern, halo: glow, box, sprite }
    })
  let lampBox = new THREE.BoxGeometry(1, 1, 1)
  // The doors of the buildings standing in a chunk.
  let doorsOf = (ci: number, ck: number) =>
    hanging.hang(v.plant(ci, ck).flatMap((p) => buildingOf(v, p) ?? []))

  // Let a chunk go, and its lamps and doors unless it `keeps` them for the
  // same chunk drawn at another detail.
  let drop = (k: string, keeps = false) => {
    let d = drawn.get(k)
    if (!d) return
    for (let m of [d.solid, d.small]) {
      if (!m) continue
      scene.remove(m)
      m.geometry.dispose()
    }
    buildings.drop(k)
    drawn.delete(k)
    if (keeps) return
    for (let l of d.lamps) {
      scene.remove(l.box, l.sprite)
      l.lantern.dispose()
      l.halo.dispose()
    }
    d.doors.drop()
  }
  let put = async (c: Chunk, lod: number) => {
    let k = key(c.ci, c.ck)
    let prepared = buildings.prepare(c.buildings, lod == 0)
    try {
      await prepared.ready
      if (gone || wants.get(k)?.lod != lod) return
      if (c.patch.voxel == v.voxel) adopt(v, c.patch)
      // What was drawn in the chunk at another detail keeps its lamps and
      // doors.
      let was = drawn.get(k)
      let lamps = was?.lamps, hung = was?.doors
      let glows = was?.glows ?? glowsOf(c.ci, c.ck)
      drop(k, true)
      prepared.draw(k)
      let solid = meshOf(c.solid, c.ci, c.ck)
      solid.castShadow = true
      solid.receiveShadow = true
      let small = c.small && meshOf(c.small, c.ci, c.ck)
      if (small) small.receiveShadow = true
      scene.add(solid)
      if (small) scene.add(small)
      let x = (c.ci + 0.5) * CHUNK, z = (c.ck + 0.5) * CHUNK
      drawn.set(k, {
        lod,
        solid,
        small,
        lamps: lamps ?? lampsOf(glows),
        glows,
        doors: hung ?? doorsOf(c.ci, c.ck),
        x,
        z,
      })
    } finally {
      prepared.release()
    }
  }
  // Every chunk wanted near the focus is drawn, at any detail.
  let close = () => [...wants].every(([k, c]) => c.d >= FIRST || drawn.has(k))
  let settle = () => {
    if (!waiting.length || !close()) return
    for (let done of waiting.splice(0)) done()
  }
  // Ask for the chunks wanted, nearest first, and let go of the ones left
  // behind.
  let stream = () => {
    if (gone) return
    let list = wanted(
      focus.x,
      focus.z,
      fog.far,
      (ci, ck) => drawn.get(key(ci, ck))?.lod,
    )
    wants = new Map(list.map((c) => [key(c.ci, c.ck), c]))
    for (let k of drawn.keys()) if (!wants.has(k)) drop(k)
    let pending = 0
    for (let { ci, ck, lod } of list) {
      let k = key(ci, ck)
      if (drawn.get(k)?.lod == lod) continue
      pending++
      if (asked.has(k) || asked.size >= ASKED) continue
      asked.add(k)
      mesh.chunk(ci, ck, lod).then(async (c) => {
        if (!gone && wants.get(k)?.lod == lod) await put(c, lod)
        asked.delete(k)
        stream()
      }).catch((e) => {
        asked.delete(k)
        reportError(e)
      })
    }
    w.pending = pending
    w.chunks = [0, 0, 0]
    for (let d of drawn.values()) w.chunks[d.lod]++
    settle()
  }

  // The water: one plane at the water line under the focus, out past the
  // fog, drawn over the ground beneath it.
  let waterMat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        deep: { value: new THREE.Color() },
        shallow: { value: new THREE.Color() },
        sheen: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(1, 1, 1) },
      },
    ]),
  })
  let water = new THREE.Mesh(new THREE.PlaneGeometry(512, 512), waterMat)
  water.rotation.x = -Math.PI / 2
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

  // The nearest village's fire and the forges in drawn chunks share one
  // flame mesh. The village fire alone has its own point light.
  let fire = new THREE.PointLight(0xffa04a, 0, 18, 1.6)
  scene.add(fire)
  let burn = flames(scene)

  let hearth: Spot | null = null
  let floor = 0
  // The fire moves to the nearest village's hearth as the focus comes near
  // it, and is not drawn with none near.
  let kindle = () => {
    let h = hearthNear(focus.x, focus.z, HEARTH)
    if (h?.[0] == hearth?.[0] && h?.[1] == hearth?.[1]) return
    hearth = h
    // A visible light keeps every material's shader signature stable.
    if (!h) return
    floor = groundAt(v, h[0], h[1])
    fire.position.set(h[0], floor + 1.1, h[1])
  }

  // One nearby source lights people in a room; the walls and furniture use
  // their baked light, so this does not grow with the village.
  let nearby = new THREE.PointLight(0xffb45c, 0, 7, 1.8)
  scene.add(nearby)
  let drift = airOf(scene)
  // How far each building's roof and upper floors have faded, from the
  // height they fade over.
  let fades = new Map<Building, { from: number; k: number }>()
  let leans = new THREE.Color(0xffffff), lean = 0
  // The look at the focus: each of the two regions' own, blended.
  let looks = () => {
    let b = blend(focus.x, focus.z)
    let la = LEVELS[b.a]?.look ?? {}, lb = LEVELS[b.b]?.look ?? la
    let haze = lerp(lb.haze ?? 1, la.haze ?? 1, b.t)
    fog.near = 40 / haze
    fog.far = 110 / haze
    leans.set(lb.sky ?? 0xffffff).lerp(new THREE.Color(la.sky ?? 0xffffff), b.t)
    lean = lerp(lb.tint ?? 0, la.tint ?? 0, b.t)
    let wa = paletteOf(LEVELS[b.a] ?? LEVELS.mossvale).water
    let wb = paletteOf(LEVELS[b.b] ?? LEVELS.mossvale).water
    ;(['deep', 'shallow', 'sheen'] as const).forEach((u, i) =>
      waterMat.uniforms[u].value.set(wb[i]).lerp(new THREE.Color(wa[i]), b.t)
    )
    return b.t > 0.5 ? la.air : lb.air
  }

  let focus = new THREE.Vector3(64, 6, 64)
  let w: World = {
    scene,
    fog,
    sun,
    focus,
    fire,
    day: 0.4,
    pending: 0,
    chunks: [0, 0, 0],
    see: (from, feet, tall, dt = 1 / 60) => {
      sight(ground, from, feet, tall)
      let want = cutaway(v, [feet.x, feet.y, feet.z], [from.x, from.y, from.z])
      for (let c of want) {
        let f = fades.get(c.b)
        if (f) f.from = c.from
        else fades.set(c.b, { from: c.from, k: 0 })
      }
      // A fifth of a second to go, and all the way, so nothing is left.
      for (let [b, f] of fades) {
        let on = want.some((c) => c.b == b)
        f.k = Math.min(1, Math.max(0, f.k + (on ? dt : -dt) * 5))
        if (!on && !f.k) fades.delete(b)
      }
      cut(
        ground,
        [...fades].sort((a, b) => b[1].k - a[1].k).slice(0, CUTS).map((
          [b, f],
        ) => ({
          lo: [b.box[0], f.from, b.box[1]],
          hi: [b.box[2], b.top + 1, b.box[3]],
          fade: f.k,
        })),
      )
    },
    swing: (near, dt) => {
      for (let d of drawn.values()) d.doors.swing(near, dt)
    },
    near: () =>
      new Promise((done) => {
        looks()
        waiting.push(done)
        stream()
      }),
    dispose: () => {
      if (gone) return
      gone = true
      for (let k of drawn.keys()) drop(k)
      hanging.dispose()
      buildings.dispose()
      let geometries = new Set<THREE.BufferGeometry>()
      let materials = new Set<THREE.Material>()
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Sprite)) return
        if (o instanceof THREE.InstancedMesh) o.dispose()
        geometries.add(o.geometry)
        for (let m of [o.material].flat()) materials.add(m)
      })
      geometries.add(lampBox)
      materials.add(ground)
      for (let g of geometries) g.dispose()
      for (let m of materials) m.dispose()
      halo.dispose()
    },
    tick: (t, dt) => {
      let air = looks()
      stream()
      kindle()
      let d = ((t / DAY) + 0.36) % 1
      w.day = d
      let l = look(d)
      l.top.lerp(leans, lean)
      l.low.lerp(leans, lean)
      l.sun.lerp(leans, lean / 2)
      drift.tick(focus, dt, air)
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
      let dark = smooth(0.24, 0.18, d) + smooth(0.76, 0.82, d)
      hemi.groundColor.copy(GRASS).lerp(DARK, dark)
      night(ground, dark)
      // Lamps unlit by day are left undrawn.
      for (let c of drawn.values()) {
        for (let l of c.lamps) {
          l.lantern.opacity = 0.95 * dark
          l.halo.opacity = 0.55 * dark
          l.box.visible = l.sprite.visible = l.halo.opacity > 0.005
        }
      }
      let lit: Glow | null = null, score = -Infinity
      for (let c of drawn.values()) {
        for (let g of c.glows) {
          let worth = 12 - Math.hypot(g.at[0] - focus.x, g.at[2] - focus.z)
          if (worth > score) score = worth, lit = g
        }
      }
      nearby.intensity = lit
        ? (0.2 + dark * 0.8) * 5 * Math.min(1, Math.max(0, score / 4))
        : 0
      if (lit) {
        nearby.position.set(lit.at[0], lit.at[1], lit.at[2])
        nearby.color.setHex(lit.color ?? 0xffc860)
        nearby.distance = 2 + lit.size * 2
      }
      skyMat.uniforms.top.value.copy(l.top)
      skyMat.uniforms.low.value.copy(l.low)
      skyMat.uniforms.sunDir.value.copy(dir)
      skyMat.uniforms.sunColor.value.copy(l.sun).multiplyScalar(up ? 1 : 0.4)
      skyMat.uniforms.night.value = dark
      fog.color.copy(l.low)
      water.position.set(
        Math.round(focus.x / CHUNK) * CHUNK,
        WATER,
        Math.round(focus.z / CHUNK) * CHUNK,
      )
      waterMat.uniforms.time.value = t
      waterMat.uniforms.sunDir.value.copy(dir)
      waterMat.uniforms.sunColor.value.copy(l.sun).multiplyScalar(l.lux / 2.7)
      fire.intensity = hearth
        ? 14 + 26 * skyMat.uniforms.night.value +
          Math.sin(t * 9) * 2 + Math.sin(t * 23) * 1.2
        : 0
      let fires: Fire[] = []
      if (hearth) {
        fires.push({
          at: [hearth[0], floor + 0.3, hearth[1]],
          size: 0.62,
        })
      }
      for (let c of drawn.values()) {
        for (let g of c.glows) {
          if (g.fire) fires.push({ at: g.at, size: 0.42 })
        }
      }
      burn(t, focus, fires)
      sky.position.copy(focus)
      for (let d of drawn.values()) {
        if (d.small) {
          d.small.visible = Math.hypot(d.x - focus.x, d.z - focus.z) < NEAR
        }
      }
    },
  }
  return w
}
