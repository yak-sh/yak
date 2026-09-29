// The nodes on stage (gather.ts, work.ts), each drawn where it stands, whole
// or spent, from a model built once per kind, state and shape. A tree is its
// land's own tree (props.ts) with logs cut and stacked at its foot, and a
// stump once felled; a seam is a boulder veined with ore, and rubble once
// mined; a herb is a clump in bloom, and bare stems once picked; a shoal is
// rings spreading on the water and a fish leaping now and then, and still
// water once fished. A node shakes at each stroke of its work, a felled tree
// topples away from whoever felled it, and whatever grows back swells up out
// of the ground. Over the node the hero can gather, a plate says what it is
// and what it asks, and over the one being worked, how far the work has come; so
// does one over a village's station while the hero stands at it. What a node
// gives, or a station makes, flies from it to the hero.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { bits, overlay } from './fx.ts'
import { STATIONS } from './craft.ts'
import { chipOf, GATHER, type Look } from './gather.ts'
import { type Glyph, glyphText } from './glyphs.ts'
import { ITEMS, meshed, type Thing } from './items.ts'
import { LIFT } from './laid.ts'
import { type Box, cuboids } from './boxes.ts'
import { baseline, type ChunkProps, natureMesh } from './nature_mesh.ts'
import {
  ball,
  blob,
  box,
  key,
  type Out,
  out,
  pack,
  place,
  type Vox,
} from './mesh.ts'
import type { Vec3 } from './play.ts'
import { model } from './props.ts'
import { GRADES, tint } from './rarity.ts'
import { naturalEid, nodeRarity } from './gather.ts'
import { hashOf, noise, rand, stream } from './rand.ts'
import { geometry, sight, soft } from './soft.ts'
import { among, off, type Stood } from './stand.ts'
import { CHUNK, chunkOf, type Vale } from './terrain.ts'
import { TRADES } from './trades.ts'
import type { Job, Seen } from './work.ts'

/** How many shapes each kind of node is drawn in. */
export let SHAPES = 4
// How far off each plan is drawn, in metres: trees stand out over the rest.
let FAR = { tree: 90, seam: 50, herb: 40, shoal: 40 }
// How high over a node its plate rides, in metres.
let HIGH = { tree: 2.4, seam: 1.2, herb: 0.9, shoal: 0.6 }
// How long a felled tree takes to fall and to sink, and anything to grow back,
// in seconds.
let TOPPLE = 0.9
let SINK = 0.6
let SWELL = 0.5
// How long what a node gives takes to fly to the hero, in seconds.
let FLIGHT = 0.45
let EMPTY: ChunkProps[] = []

// Logs cut and stacked beside a tree, south of its trunk, their ends the
// colour of the wood.
let logs = (o: Out, bark: number, wood: number) =>
  cuboids(
    o,
    [[-0.3, 0, 0.6], [-0.3, 0, 0.95], [-0.3, 0.3, 0.78]].flatMap((
      [x, y, z],
    ): Box[] => [
      [[x, y, z], [1.1, 0.32, 0.32], bark],
      ...[x - 0.02, x + 1.1].map((e): Box => [
        [e, y + 0.04, z + 0.04],
        [0.02, 0.24, 0.24],
        wood,
        0.02,
      ]),
    ]),
    0.08,
    0.04,
  )

// A stump, its cut face the colour of the wood, and chips round it.
let stump = (o: Out, bark: number, wood: number, seed: number) => {
  cuboids(o, [
    [[-0.32, 0, -0.32], [0.64, 0.55, 0.64], bark, 0.05],
    [[-0.27, 0.55, -0.27], [0.54, 0.03, 0.54], wood, 0.02],
  ], 0.12)
  let r = stream(seed)
  let chips = Array.from({ length: 6 }, (): Box => {
    let a = r() * Math.PI * 2, d = 0.5 + r() * 0.5
    return [[Math.cos(a) * d, 0, Math.sin(a) * d], [0.12, 0.04, 0.07], wood]
  })
  cuboids(o, chips, 0.05, 0.01)
}

// The highest voxel of a column of `v`, or -1.
let topOf = (v: Vox, x: number, z: number) => {
  for (let y = 12; y >= 0; y--) if (v.has(key(x, y, z))) return y
  return -1
}

// A boulder flecked with ore, crystals of it standing out of its top; and,
// spent, a few lumps of the plain stone.
let seam = (
  look: Extract<Look, { plan: 'seam' }>,
  seed: number,
  whole: boolean,
) => {
  let r = stream(seed), v: Vox = new Map()
  let [a, b, c] = look.stone
  let stone = (x: number, y: number, z: number) =>
    (x + y + z) & 1 ? a : (x * 7 + z) % 3 == 0 ? c : b
  if (whole) {
    let R = 3.4 + r() * 0.5
    ball(v, [0, 1, 0], R, (x, y, z) => {
      if (y < 0) return null
      let skin = x * x + (y - 1) ** 2 + z * z > (R - 1.2) ** 2
      let streak = noise(
        x * 0.7 + y * 0.4 + (seed % 31),
        z * 0.7 - y * 0.4,
        seed,
      )
      return skin && (streak > 0.66 || rand(x * 3 + y, z * 5 + y, seed) < 0.08)
        ? look.vein
        : stone(x, y, z)
    })
    // Crystals of the ore standing out of it, leaning out as they rise.
    for (let i = 0; i < 3; i++) {
      let t = (i / 3 + r() * 0.2) * Math.PI * 2, d = 1 + r() * 1.5
      let x = Math.round(Math.cos(t) * d), z = Math.round(Math.sin(t) * d)
      let y = topOf(v, x, z)
      if (y < 0) continue
      let tall = 2 + Math.floor(r() * 2)
      for (let k = 1; k <= tall; k++) {
        let lean = k > 1 ? 1 : 0
        v.set(
          key(x + Math.sign(x) * lean, y + k, z + Math.sign(z) * lean),
          look.vein,
        )
      }
    }
  } else {
    for (let i = 0; i < 3; i++) {
      let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
      ball(
        v,
        [x, 0, z],
        1.1 + r() * 0.5,
        (x, y, z) => y < 0 ? null : stone(x, y, z),
      )
    }
  }
  return blob(out(), v, 0.25, [-0.125, 0, -0.125])
}

let herb = (
  look: Extract<Look, { plan: 'herb' }>,
  seed: number,
  whole: boolean,
) => {
  let r = stream(seed), v: Vox = new Map()
  let leaves = [
    look.leaf,
    new THREE.Color(look.leaf).offsetHSL(0, 0, 0.06).getHex(),
  ]
  let leaf = (x: number, y: number, z: number) => leaves[(x + y + z) & 1]
  if (!whole) {
    for (let i = 0; i < 5; i++) {
      let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
      box(v, [x, 0, z], [x, Math.floor(r() * 2), z], 0x6a5a3a)
    }
  } else if (look.form == 'bush') {
    let R = 3.3
    box(v, [0, 0, 0], [0, 1, 0], 0x6a4a30)
    ball(v, [0, 3, 0], R, (x, y, z) => {
      if (y < 1) return null
      let rim = x * x + (y - 3) ** 2 + z * z > (R - 1) ** 2
      return rim && rand(x + 9, y * 7 + z, seed) < 0.2
        ? look.bloom
        : leaf(x, y, z)
    })
  } else if (look.form == 'stalks') {
    for (let i = 0; i < 7; i++) {
      let x = Math.floor(r() * 7) - 3, z = Math.floor(r() * 7) - 3
      let tall = 4 + Math.floor(r() * 4)
      box(v, [x, 0, z], [x, tall, z], look.leaf)
      v.set(key(x + (i & 1 ? 1 : -1), 2 + (i % 3), z), look.leaf)
      box(v, [x, tall + 1, z], [x + 1, tall + 2, z], look.bloom)
      v.set(key(x, tall + 1, z + 1), look.bloom)
    }
  } else {
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(r() * 7) - 3, z = Math.floor(r() * 7) - 3
      let tall = 2 + Math.floor(r() * 3)
      box(v, [x, 0, z], [x, tall, z], look.leaf)
      box(v, [x - 1, tall + 1, z - 1], [x + 1, tall + 1, z + 1], look.bloom)
      v.set(key(x, tall + 2, z), look.bloom)
      v.set(key(x + 1, tall + 1, z + 1), 0xfbf6ea)
    }
  }
  return blob(out(), v, 0.125, [-0.0625, 0, -0.0625])
}

let tree = (
  look: Extract<Look, { plan: 'tree' }>,
  seed: number,
  whole: boolean,
) => {
  let o = out()
  if (whole) {
    place(o, model(look.prop, seed), [0, 0, 0])
    logs(o, look.bark, look.wood)
  } else stump(o, look.bark, look.wood, seed)
  return o
}

/** A node's model, whole or spent, in the `shape`th of its kind's shapes: a
 * tree, a seam or a herb, as triangles with its foot at the origin; a shoal
 * is drawn on the water, not modelled. */
export let modelOf = (look: Look, whole: boolean, shape: number): Out => {
  let seed = shape * 7919 + 17
  return look.plan == 'tree'
    ? tree(look, seed, whole)
    : look.plan == 'seam'
    ? seam(look, seed, whole)
    : look.plan == 'herb'
    ? herb(look, seed, whole)
    : out()
}

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// A node's model, whole or spent; a whole shoal is its rings and its fish.
type Body = {
  obj: THREE.Object3D
  rings?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[]
  fish?: THREE.Mesh
}

type Drawn = {
  group: THREE.Group
  whole: Body | null
  spent: Body | null
  /** whole the last frame it was seen */
  was: boolean | null
  /** struck this recently, 1 just now to 0 */
  shake: number
  /** seconds since it grew back, while it swells */
  grow: number
  seen: boolean
}

/** The nodes of one level's scene. `glow` is where a seam glints from; a
 * phone's player has a button to work a node, and is not told of a key. */
export let nodes = (
  scene: THREE.Scene,
  v: Vale,
  plates: Pick<ReturnType<typeof overlay>, 'plate'>,
  glow: Pick<ReturnType<typeof bits>, 'emit'>,
  phone: boolean,
) => {
  let mat = soft({ speckle: 0.08, see: true })
  let water = new THREE.MeshBasicMaterial({
    color: 0xf4fbff,
    transparent: true,
    depthWrite: false,
  })
  let ringGeo = new THREE.RingGeometry(0.9, 1, 40)
  let made = new Map<string, THREE.BufferGeometry>()
  let itemGeo = new Map<
    string,
    { item: Thing | undefined; geo: THREE.BufferGeometry }
  >()
  let models = new Map<string, Out>()
  let modelFor = (n: Seen, whole: boolean, shape: number): Out => {
    let id = `${n.kind}:${whole}:${shape}`
    let got = models.get(id)
    if (!got) models.set(id, got = modelOf(n.lode.look, whole, shape))
    return got
  }
  let geo = (key: string, make: () => Out) => {
    let g = made.get(key)
    if (!g) made.set(key, g = geometry(pack(make())))
    return g
  }
  let drawn = new Map<string, Drawn>()
  let naturalWas = new Map<string, boolean>()
  let wild = new Map<
    string,
    { mesh: THREE.Mesh; state: string; source: ChunkProps }
  >()
  let next = among(v), stepped = new Map<string, number>()
  let shown: ChunkProps[] | null = null, stands: Stood[] = []
  let stepOf = (n: Seen) => {
    let got = stepped.get(n.eid)
    if (got != null) return got
    let shape = hashOf(n.eid) % SHAPES
    got = next(n.at, [
      modelFor(n, true, shape),
      modelFor(n, false, shape),
    ], stands)
    stepped.set(n.eid, got)
    return got
  }
  // Felled trees falling, and things flying to the hero.
  let falling: {
    obj: THREE.Object3D
    t: number
    axis: THREE.Vector3
    geo?: THREE.BufferGeometry
  }[] = []
  let flying: { obj: THREE.Mesh; from: THREE.Vector3; t: number }[] = []
  let topple = (
    obj: THREE.Object3D,
    at: THREE.Vector3,
    hero: Vec3,
    geo?: THREE.BufferGeometry,
  ) => {
    let away = new THREE.Vector3(at.x - hero[0], 0, at.z - hero[2])
    if (away.lengthSq() < 1e-6) away.set(1, 0, 0)
    away.normalize()
    obj.removeFromParent()
    obj.position.copy(at)
    scene.add(obj)
    falling.push({
      obj,
      t: 0,
      axis: new THREE.Vector3(away.z, 0, -away.x),
      geo,
    })
  }

  // What an item looks like, as loot does (cast.ts).
  let itemModel = (kind: string) => {
    let item = ITEMS[kind], had = itemGeo.get(kind)
    if (had && had.item == item) return had.geo
    had?.geo.dispose()
    let geo = geometry(pack(meshed(item?.look ?? [])))
    itemGeo.set(kind, { item, geo })
    return geo
  }
  let thing = (kind: string) => new THREE.Mesh(itemModel(kind), mat)

  // A node's model, whole or spent, sharing geometry with its kind and shape.
  let body = (n: Seen, whole: boolean): Body | null => {
    let look = n.lode.look
    let shape = hashOf(n.eid) % SHAPES
    if (look.plan == 'shoal') {
      if (!whole) return null
      let obj = new THREE.Group()
      let rings = [0, 1].map(() => {
        let ring = new THREE.Mesh(ringGeo, water.clone())
        ring.rotation.x = -Math.PI / 2
        ring.position.y = LIFT
        obj.add(ring)
        return ring
      })
      let fish = thing(n.lode.gives)
      fish.visible = false
      fish.scale.setScalar(1.6)
      obj.add(fish)
      return { obj, rings, fish }
    }
    let mesh = new THREE.Mesh(
      geo(`${n.kind}:${whole}:${shape}`, () => modelFor(n, whole, shape)),
      mat,
    )
    mesh.castShadow = look.plan != 'herb'
    mesh.receiveShadow = true
    return { obj: mesh }
  }
  // Take a node's model off the stage, and let go of its rings.
  let drop = (b: Body | null) => {
    if (!b) return
    b.obj.removeFromParent()
    for (let r of b.rings ?? []) r.material.dispose()
  }

  // How far the work has come, as a bar under a plate's name.
  let bar = (k: number) =>
    `<span class="Plate_Bar Plate_Bar-work"><i style="--k:${
      Math.min(1, k).toFixed(3)
    }"></i></span>`
  let hint = (mark: Glyph, verb: string) =>
    `<em>${glyphText(mark)} ${verb}${phone ? '' : ' · E'}</em>`

  let plate = (n: Seen, job: Job) => {
    if (n.spent) return
    let doing = job.doing?.node?.eid == n.eid ? job.doing : null
    if (!doing && job.near?.eid != n.eid) return
    let t = TRADES[n.lode.trade]
    let name = `<b>${esc(n.name)}</b>${
      n.rarity == 'common' ? '' : ` <em>${GRADES[n.rarity].name}</em>`
    }`
    let html = doing
      ? `<span>${name}</span>${bar(doing.k)}`
      : `<span>${name} ${hint(t.icon, GATHER[n.lode.trade].verb)}</span>`
    let [x, y, z] = n.at
    plates.plate(
      `node:${n.eid}`,
      new THREE.Vector3(x, y + HIGH[n.lode.look.plan], z),
      html,
      `Plate Plate-node ${tint(n.rarity)}`,
    )
  }

  let v3 = (a: Vec3, up = 0) => new THREE.Vector3(a[0], a[1] + up, a[2])

  // The station the hero stands at: what it is, and how far a making there
  // has come.
  let bench = (job: Job) => {
    let b = job.bench
    if (!b || job.near) return
    let s = STATIONS[b.craft], t = TRADES[b.craft]
    let doing = job.doing?.recipe ? job.doing : null
    let name = `<b>${esc(s.name)}</b>`
    plates.plate(
      `bench:${b.at.join()}`,
      v3(b.at, 1.9),
      doing
        ? `<span>${name}</span>${bar(doing.k)}`
        : `<span>${name} ${hint(t.icon, t.name)}</span>`,
      'Plate Plate-node',
    )
  }

  return {
    /** Draw this frame's nodes, with the hero at `hero`. */
    tick: (job: Job, hero: Vec3, dt: number, chunks: ChunkProps[] = EMPTY) => {
      let t = performance.now() / 1000
      let rebased = shown != chunks
      if (rebased) {
        shown = chunks
        stands = chunks.flatMap((c) => c.stood)
        next = among(v)
        stepped.clear()
      }
      let natural = new Map<string, Seen[]>()
      let naturalSeen = new Set<string>()
      let byChunk = new Map(chunks.map((c) => [`${c.ci} ${c.ck}`, c]))
      for (let d of drawn.values()) d.seen = false
      for (let e of job.events) {
        let d = e.type == 'stroke' ? drawn.get(e.eid) : undefined
        if (d) d.shake = 1
      }
      for (let n of job.nodes) {
        let plan = n.lode.look.plan
        if (n.near > FAR[plan]) continue
        if (n.prop) {
          let id = `${chunkOf(n.at[0])} ${chunkOf(n.at[2])}`
          let group = natural.get(id) ?? []
          group.push(n)
          natural.set(id, group)
          naturalSeen.add(n.eid)
          let was = naturalWas.get(n.eid)
          if (was && n.spent && plan == 'tree') {
            let packed = pack(model(
              n.prop.kind,
              n.prop.seed,
              n.prop.turn,
              true,
              byChunk.get(id)?.voxel ?? v.voxel,
            ))
            let geo = geometry(packed)
            let fall = new THREE.Mesh(geo, mat)
            fall.castShadow = true
            fall.receiveShadow = true
            topple(fall, v3(n.at), hero, geo)
          }
          naturalWas.set(n.eid, !n.spent)
          if (
            !n.spent && n.rarity != 'common' && n.near < 30 &&
            Math.random() < dt * 2
          ) {
            glow.emit(
              v3(n.at, 0.5 + Math.random() * 1.5),
              GRADES[n.rarity].light,
              1,
              {
                speed: 0.2,
                up: 0.6,
                life: 0.8,
                size: 0.08,
                fall: 0,
              },
            )
          }
          plate(n, job)
          continue
        }
        let d = drawn.get(n.eid)
        if (!d) {
          let group = new THREE.Group()
          scene.add(group)
          d = {
            group,
            whole: null,
            spent: null,
            was: null,
            shake: 0,
            grow: SWELL,
            seen: true,
          }
          drawn.set(n.eid, d)
        }
        if (rebased || d.was == null) {
          let [dx, dy, dz] = off(stepOf(n))
          d.group.position.set(n.at[0] + dx, n.at[1] + dy, n.at[2] + dz)
        }
        d.seen = true
        if (d.whole?.fish) d.whole.fish.geometry = itemModel(n.lode.gives)
        let whole = !n.spent
        if (d.was != whole) {
          // Felled while in sight: a tree topples away from the hero, and
          // anything else is simply gone.
          if (d.was && d.whole && plan == 'tree') {
            topple(d.whole.obj, d.group.position, hero)
          } else drop(d.whole)
          drop(d.spent)
          d.whole = whole ? body(n, true) : null
          d.spent = whole ? null : body(n, false)
          if (d.whole) d.group.add(d.whole.obj)
          if (d.spent) d.group.add(d.spent.obj)
          // Grown back while in sight: it swells up.
          d.grow = whole && d.was === false ? 0 : SWELL
          d.was = whole
        }
        // Growing back, and shaking at a stroke.
        d.grow = Math.min(SWELL, d.grow + dt)
        let g = d.grow / SWELL
        let swell = g >= 1 ? 1 : 1 + 2.7 * (g - 1) ** 3 + 1.7 * (g - 1) ** 2
        d.shake = Math.max(0, d.shake - dt * 3)
        let w = d.whole?.obj
        if (w && plan != 'shoal') {
          w.scale.setScalar(Math.max(0.05, swell))
          w.rotation.z = Math.sin(t * 38) * 0.05 * d.shake
          w.rotation.x = Math.cos(t * 31) * 0.03 * d.shake
          if (plan != 'tree') {
            w.scale.y *= 1 - 0.12 * d.shake * Math.abs(Math.sin(t * 30))
          }
        }
        if (
          w && n.rarity != 'common' && n.near < 30 &&
          Math.random() < dt * 2
        ) {
          glow.emit(
            v3(n.at, 0.5 + Math.random() * 1.5),
            GRADES[n.rarity].light,
            1,
            {
              speed: 0.2,
              up: 0.6,
              life: 0.8,
              size: 0.08,
              fall: 0,
            },
          )
        }
        // A shoal: rings spreading, faster while it is fished, and now and
        // then a fish leaping out.
        let { rings, fish } = d.whole ?? {}
        if (rings && fish) {
          let salt = hashOf(n.eid)
          rings.forEach((ring, i) => {
            let k = (t * 0.45 * (1 + d.shake * 2) + i / 2 + (salt % 97) / 97) %
              1
            ring.scale.setScalar(0.3 + k * 1.4)
            ring.material.opacity = 0.55 * (1 - k)
          })
          let leap = ((t + (salt % 11)) % (4 + (salt % 3))) / 0.7
          fish.visible = leap < 1
          fish.position.set(
            0,
            Math.sin(leap * Math.PI) * 0.7 - 0.1,
            (leap - 0.5) * 1.2,
          )
          fish.rotation.x = (leap - 0.5) * 2.4
        }
        // A whole seam glints now and then.
        if (w && plan == 'seam' && n.near < 25 && Math.random() < dt * 0.8) {
          let a = Math.random() * Math.PI * 2
          glow.emit(
            v3(n.at, 0.3 + Math.random() * 0.4).add(
              new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55),
            ),
            chipOf(n.lode.look),
            1,
            { speed: 0.2, up: 0.4, life: 0.5, size: 0.05, fall: 0 },
          )
        }
        plate(n, job)
      }
      // The worker gives each chunk its whole mesh. Only a harvest or
      // respawn rebuilds that one chunk on the page's thread.
      for (let [id, group] of natural) {
        let chunk = byChunk.get(id)
        if (!chunk?.nature) continue
        let changed = group.filter((n) =>
          n.spent || n.rarity != nodeRarity(n.eid, 0)
        )
        let state = changed.map((n) =>
          `${n.eid}:${n.spent}:${n.rarity}`
        ).join('|') || 'base'
        let old = wild.get(id)
        if (old?.state == state && old.source == chunk) continue
        let seen = new Map(group.map((n) => [n.eid, n]))
        let packed = state == 'base' ? chunk.nature : natureMesh(
          chunk.ci,
          chunk.ck,
          chunk.natural.map((entry) => {
            let n = seen.get(naturalEid(entry.prop))
            return n
              ? { ...entry, spent: n.spent, rarity: n.rarity }
              : baseline(entry)
          }),
          chunk.voxel,
        )
        if (!packed) continue
        let mesh = new THREE.Mesh(geometry(packed), mat)
        mesh.position.set(chunk.ci * CHUNK, 0, chunk.ck * CHUNK)
        mesh.castShadow = true
        mesh.receiveShadow = true
        if (old) {
          old.mesh.removeFromParent()
          old.mesh.geometry.dispose()
        }
        scene.add(mesh)
        wild.set(id, { mesh, state, source: chunk })
      }
      for (let [id, batch] of wild) {
        if (natural.has(id)) continue
        batch.mesh.removeFromParent()
        batch.mesh.geometry.dispose()
        wild.delete(id)
      }
      bench(job)

      // What was gathered or made flies from its node or station to the hero.
      for (let e of job.events) {
        if (e.type != 'got') continue
        let obj = thing(e.item)
        obj.scale.setScalar(1.8)
        scene.add(obj)
        flying.push({ obj, from: v3(e.at, 0.6), t: 0 })
      }
      let to = v3(hero, 1)
      flying = flying.filter((f) => {
        f.t += dt / FLIGHT
        if (f.t >= 1) {
          scene.remove(f.obj)
          return false
        }
        f.obj.position.lerpVectors(f.from, to, f.t)
        f.obj.position.y += Math.sin(f.t * Math.PI) * 1.2
        f.obj.rotation.y += dt * 9
        return true
      })
      falling = falling.filter((f) => {
        f.t += dt
        let k = Math.min(1, f.t / TOPPLE)
        f.obj.setRotationFromAxisAngle(f.axis, (k * k) * Math.PI / 2 * 0.96)
        if (f.t > TOPPLE) f.obj.position.y -= dt * 2.5
        if (f.t < TOPPLE + SINK) return true
        scene.remove(f.obj)
        f.geo?.dispose()
        return false
      })

      for (let eid of naturalWas.keys()) {
        if (!naturalSeen.has(eid)) naturalWas.delete(eid)
      }

      for (let [eid, d] of drawn) {
        if (d.seen) continue
        drop(d.whole)
        scene.remove(d.group)
        drawn.delete(eid)
      }
    },
    /** keep the camera's sight of the hero clear (world.ts `see`) */
    see: (from: THREE.Vector3, feet: THREE.Vector3, tall: number) =>
      sight(mat, from, feet, tall),
    /** let the GPU go of what the nodes drew */
    dispose: () => {
      for (let batch of wild.values()) {
        batch.mesh.removeFromParent()
        batch.mesh.geometry.dispose()
      }
      for (let d of drawn.values()) {
        drop(d.whole)
        scene.remove(d.group)
      }
      for (let f of falling) {
        scene.remove(f.obj)
        f.geo?.dispose()
      }
      for (let f of flying) scene.remove(f.obj)
      for (let g of made.values()) g.dispose()
      ringGeo.dispose()
      mat.dispose()
      water.dispose()
    },
  }
}
