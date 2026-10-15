/** Holdfast's replaceable voxel skin. GPU/audio handles belong to the bootstrap;
 * the page graph supplies camera facts and all game facts as values. */
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { along, hashOf, lerp } from '@yaks/game'
import { cursor, groundRay, pickRay } from '@yaks/stage/aim'
import { aim } from '@yaks/stage/cam'
import { type Bus, bus } from '@yaks/stage/bus'
import { ear } from '@yaks/stage/ears'
import { type Sources, sources } from '@yaks/stage/sound'
import { renderer } from '@yaks/stage/render'
import { type Box, cuboids, metal, out, pack } from '@yaks/voxel'
import {
  geometry,
  type Puppet,
  puppet,
  type Rig,
  soft,
} from '@yaks/voxel/three'
import type { MapDesign, Row } from './model.ts'

export type View = { yaw: number; pitch: number; zoom: number }

export type Look = {
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  board: THREE.Group
  actors: THREE.Group
  selection: THREE.Mesh
  range: THREE.Mesh
  material: THREE.Material
  geometries: Map<string, THREE.BufferGeometry>
  meshes: Map<string, THREE.Object3D>
  puppets: Map<string, Puppet>
  health: Map<string, THREE.Sprite>
  mapKey: string
  width: number
  height: number
  audio: AudioContext | null
  voices: Sources<'effects'> | null
  volume: Bus
  draw(
    rows: Row[],
    runId: string,
    selectedSlot: number | null,
    now: number,
    view?: View,
  ): void
  pick(clientX: number, clientY: number): number | null
  sound(kind: string, slot?: number): void
  dispose(): void
}

let box = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
): Box => [[x, y, z], [w, h, d], color]

let ring = (color: number, opacity = 1) => {
  let mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.79, 0.9, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.145
  return mesh
}

/** Create GPU handles, not a second game model. No listeners or loop are hidden. */
export let createLook = (canvas: HTMLCanvasElement): Look => {
  let scene = new THREE.Scene()
  scene.background = new THREE.Color(0x192c32)
  scene.fog = new THREE.Fog(0x192c32, 50, 110)
  let camera = new THREE.PerspectiveCamera(40, 1, 0.1, 150)
  let gpu = renderer(canvas, 1, 1, Math.min(devicePixelRatio || 1, 1.75))
  gpu.setClearColor(0x192c32)
  let hemi = new THREE.HemisphereLight(0xd7f0ef, 0x3e3028, 2.5)
  let sun = new THREE.DirectionalLight(0xffe6b8, 3.4)
  sun.position.set(-12, 24, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -22
  sun.shadow.camera.right = sun.shadow.camera.top = 22
  sun.shadow.normalBias = 0.055
  sun.shadow.bias = -0.0002
  let rim = new THREE.DirectionalLight(0x80cbd0, 1.8)
  rim.position.set(10, 9, -12)
  scene.add(hemi, sun, sun.target, rim)
  let board = new THREE.Group(), actors = new THREE.Group()
  let selection = ring(0xffda7e), range = ring(0xffda7e, 0.18)
  range.geometry.dispose()
  range.geometry = new THREE.RingGeometry(0.985, 1, 96)
  range.position.y = 0.12
  selection.visible = range.visible = false
  scene.add(board, actors, selection, range)
  let look: Look = {
    canvas,
    renderer: gpu,
    scene,
    camera,
    board,
    actors,
    selection,
    range,
    material: soft({ speckle: 0.11 }),
    geometries: new Map(),
    meshes: new Map(),
    puppets: new Map(),
    health: new Map(),
    mapKey: '',
    width: 0,
    height: 0,
    audio: null,
    voices: null,
    volume: bus(0.55),
    draw: (rows, runId, slot, now, view) =>
      draw(look, rows, runId, slot, now, view),
    pick: (x, y) => pick(look, x, y),
    sound: (kind, slot) => sound(look, kind, slot),
    dispose: () => dispose(look),
  }
  return look
}

let mesh = (look: Look, key: string, boxes: Box[], cell = 0.16) => {
  let shape = look.geometries.get(key)
  if (!shape) {
    shape = geometry(pack(cuboids(out(), boxes, cell)))
    look.geometries.set(key, shape)
  }
  let item = new THREE.Mesh(shape, look.material)
  item.castShadow = item.receiveShadow = true
  return item
}

let towerBoxes = (family: string, tier: number, color: number): Box[] => {
  let stone = 0xb6b7a6, dark = 0x454f53, wood = 0x876046
  let boxes = [
    box(-0.57, 0.12, -0.57, 1.14, 0.21, 1.14, stone),
    box(-0.44, 0.33, -0.44, 0.88, 0.67 + tier * 0.12, 0.88, 0x718280),
    box(-0.52, 0.91 + tier * 0.12, -0.52, 1.04, 0.16, 1.04, stone),
    box(-0.12, 0.44, -0.46, 0.24, 0.36, 0.08, color),
  ]
  let y = 1.06 + tier * 0.12
  if (/frost|ice|crystal|arcane/i.test(family)) {
    boxes.push(
      box(-0.29, y, -0.29, 0.58, 0.24, 0.58, dark),
      box(-0.19, y + 0.24, -0.19, 0.38, 0.75, 0.38, color),
      box(-0.1, y + 0.99, -0.1, 0.2, 0.26, 0.2, 0xd1ffff),
      box(-0.44, y + 0.32, -0.09, 0.88, 0.18, 0.18, 0x81bfc6),
      box(-0.09, y + 0.32, -0.44, 0.18, 0.18, 0.88, 0x81bfc6),
    )
  } else if (/ember|fire|flame/i.test(family)) {
    boxes.push(
      box(-0.36, y, -0.36, 0.72, 0.25, 0.72, metal(0xac7953)),
      box(-0.24, y + 0.25, -0.24, 0.48, 0.22, 0.48, 0xe9a34d),
      box(-0.15, y + 0.47, -0.15, 0.3, 0.38, 0.3, color),
      box(-0.07, y + 0.85, -0.07, 0.14, 0.18, 0.14, 0xffe0a2),
    )
  } else if (/cannon|mortar|bomb/i.test(family)) {
    boxes.push(
      box(-0.36, y, -0.29, 0.72, 0.36, 0.58, wood),
      box(-0.25, y + 0.16, -0.44, 0.5, 0.46, 0.9, metal(dark)),
      box(-0.32, y + 0.2, 0.35, 0.64, 0.46, 0.17, metal(0x8a9893)),
      box(-0.17, y + 0.3, 0.52, 0.34, 0.25, 0.03, 0x1e292d),
      box(-0.45, y - 0.04, -0.08, 0.9, 0.2, 0.2, color),
    )
  } else {
    boxes.push(
      box(-0.12, y, -0.12, 0.24, 0.4, 0.24, wood),
      box(-0.1, y + 0.36, -0.55, 0.2, 0.2, 1.15, wood),
      box(-0.62, y + 0.34, 0.02, 1.24, 0.16, 0.16, color),
      box(-0.71, y + 0.4, -0.22, 0.16, 0.13, 0.32, wood),
      box(0.55, y + 0.4, -0.22, 0.16, 0.13, 0.32, wood),
      box(-0.035, y + 0.58, -0.28, 0.07, 0.06, 0.92, metal(0xc9d0c0)),
    )
  }
  for (let n = 0; n < tier; n++) {
    boxes.push(box(0.36, 0.44 + n * 0.16, -0.47, 0.11, 0.09, 0.04, 0xffd37e))
  }
  return boxes
}

let enemyBoxes = (family: string, color: number): Box[] => {
  let armour = /armour|armor|brute|golem|shell|iron|stone/i.test(family)
  let swift = /swift|runner|skitter|hare/i.test(family)
  let size = armour ? 0.88 : swift ? 0.58 : 0.7
  return [
    box(-size / 2, 0.18, -size / 2, size, armour ? 0.74 : 0.52, size, color),
    box(
      -size / 2 + 0.05,
      armour ? 0.84 : 0.65,
      -size / 2,
      size - 0.1,
      0.24,
      size * 0.7,
      armour ? metal(0x9caaa4) : color,
    ),
    box(-size * 0.28, 0.56, size / 2 - 0.02, 0.11, 0.11, 0.05, 0xffe6a1),
    box(size * 0.15, 0.56, size / 2 - 0.02, 0.11, 0.11, 0.05, 0xffe6a1),
    box(-size * 0.4, 0.04, -size * 0.32, 0.19, 0.2, 0.22, 0x4c5143),
    box(size * 0.2, 0.04, size * 0.12, 0.19, 0.2, 0.22, 0x4c5143),
  ]
}

/** Models remain authored by the skin; the designs supply palette and scale. */
let enemyRig = (family: string, color: number): Rig => ({
  height: 1.1,
  gait: /hare|runner/i.test(family) ? 'hop' : 'walk',
  bite: 'lunge',
  fall: 'topple',
  parts: [
    {
      name: 'body',
      pivot: [0, 0, 0],
      boxes: enemyBoxes(family, color).slice(0, 4),
    },
    ...[-1, 1].flatMap((side) =>
      [-1, 1].map((front) => ({
        name: `leg/${side}/${front}`,
        pivot: [side * 0.24, 0.23, front * 0.25] as [number, number, number],
        boxes: [box(-0.1, -0.2, -0.12, 0.2, 0.3, 0.24, 0x495746)],
        move: { leg: { phase: side == front ? 0 : 0.5 } },
      }))
    ),
  ],
})

let releasePuppet = (p: Puppet) => {
  p.material.dispose()
  p.root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose()
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose()
  })
}

let tree = (look: Look, x: number, z: number, n: number) => {
  let color = n % 3 == 0 ? 0xb2a268 : n % 3 == 1 ? 0x557b65 : 0x6f9470
  let tree = mesh(look, `tree/${n % 3}`, [
    box(-0.12, 0, -0.12, 0.24, 0.9, 0.24, 0x735644),
    box(-0.56, 0.62, -0.56, 1.12, 0.62, 1.12, color),
    box(-0.4, 1.24, -0.4, 0.8, 0.51, 0.8, color),
    box(-0.23, 1.75, -0.23, 0.46, 0.4, 0.46, color),
  ])
  tree.position.set(x, 0.12, z)
  tree.rotation.y = n * 0.73
  look.board.add(tree)
}

let buildBoard = (look: Look, map: MapDesign) => {
  look.board.clear()
  let points = [...map.path.map(([x, , z]) => [x, z]), ...map.slots]
  let loX = Math.min(...points.map((p) => p[0])) - 2.6
  let hiX = Math.max(...points.map((p) => p[0])) + 2.6
  let loZ = Math.min(...points.map((p) => p[1])) - 2.6
  let hiZ = Math.max(...points.map((p) => p[1])) + 2.6
  let width = hiX - loX, depth = hiZ - loZ
  look.board.add(mesh(look, `island/${loX}/${loZ}/${width}/${depth}`, [
    box(loX + 0.6, -1.7, loZ + 0.6, width - 1.2, 0.65, depth - 1.2, 0x384e4c),
    box(
      loX + 0.24,
      -1.15,
      loZ + 0.24,
      width - 0.48,
      0.8,
      depth - 0.48,
      0x655e4b,
    ),
    box(loX, -0.36, loZ, width, 0.46, depth, 0x78916b),
  ], 0.32))
  for (let i = 1; i < map.path.length; i++) {
    let a = map.path[i - 1], b = map.path[i]
    let length = Math.hypot(b[0] - a[0], b[2] - a[2])
    let stone = mesh(look, `path/${length}`, [
      box(-0.67, 0.1, -length / 2 - 0.65, 1.34, 0.035, length + 1.3, 0xc8b18a),
    ], 0.22)
    stone.position.set((a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2)
    stone.rotation.y = Math.atan2(b[0] - a[0], b[2] - a[2])
    stone.receiveShadow = true
    look.board.add(stone)
    for (let d = 1; d < length; d += 1.5) {
      let p = along([a, b], d)
      let flag = mesh(look, 'path/mark', [
        box(-0.06, 0.14, -0.22, 0.12, 0.01, 0.44, 0xa28d6f),
      ])
      flag.position.set(p[0], 0, p[2])
      flag.rotation.y = stone.rotation.y
      look.board.add(flag)
    }
  }
  map.slots.forEach(([x, z], i) => {
    let plinth = mesh(look, 'slot', [
      box(-0.7, 0.1, -0.7, 1.4, 0.09, 1.4, 0x526b60),
      box(-0.62, 0.19, -0.62, 1.24, 0.045, 1.24, 0x9eb29a),
      box(-0.07, 0.24, -0.27, 0.14, 0.01, 0.54, 0x587765),
      box(-0.27, 0.24, -0.07, 0.54, 0.01, 0.14, 0x587765),
    ])
    plinth.position.set(x, 0, z)
    plinth.name = `slot-${i}`
    look.board.add(plinth)
  })
  // A sparse border leaves the route and every build pad legible.
  let border: [number, number][] = []
  for (let x = loX + 0.9; x < hiX; x += 2.1) {
    border.push([x, loZ + 0.8], [x, hiZ - 0.8])
  }
  for (let z = loZ + 2.8; z < hiZ - 1; z += 2.1) {
    border.push([loX + 0.8, z], [hiX - 0.8, z])
  }
  border.forEach(([x, z], i) => {
    if (map.path.some((p) => Math.hypot(p[0] - x, p[2] - z) < 2.2)) return
    if (map.slots.some((p) => Math.hypot(p[0] - x, p[1] - z) < 1.8)) return
    tree(look, x, z, i)
  })
  let end = map.path.at(-1)!
  let fort = mesh(look, 'fort', [
    box(-1.35, 0.1, -0.65, 0.72, 1.9, 1.3, 0xa4b3a5),
    box(0.63, 0.1, -0.65, 0.72, 1.9, 1.3, 0xa4b3a5),
    box(-1.4, 1.97, -0.7, 2.8, 0.34, 1.4, 0xc5c5ad),
    box(-1.35, 2.31, -0.65, 0.52, 0.35, 0.5, 0xc5c5ad),
    box(0.83, 2.31, -0.65, 0.52, 0.35, 0.5, 0xc5c5ad),
    box(-0.22, 2.31, -0.65, 0.44, 0.35, 0.5, 0xc5c5ad),
    box(-0.04, 2.3, 0, 0.08, 1.08, 0.08, 0x74593c),
    box(0.04, 2.88, 0, 0.68, 0.4, 0.06, 0xe8b85f),
  ])
  let before = map.path.at(-2) ?? end
  fort.position.set(end[0], 0, end[2])
  fort.rotation.y = Math.atan2(end[0] - before[0], end[2] - before[2])
  look.board.add(fort)
}

let colorOf = (
  figure: Record<string, unknown> | undefined,
  fallback: number,
) => {
  let color = figure?.color ?? figure?.tint
  return typeof color == 'number'
    ? color
    : typeof color == 'string'
    ? new THREE.Color(color).getHex()
    : fallback
}

/** Render from current rows. Prediction is clock-derived and bounded, never a
 * second position authority; a stopped sender cannot drift off along the path. */
export let draw = (
  look: Look,
  rows: Row[],
  runId: string,
  selectedSlot: number | null,
  now: number,
  view: View = { yaw: -0.48, pitch: 0.86, zoom: 1 },
): void => {
  let run = rows.find((r) => r.entity.eid == runId)?.run
  let mapRow = rows.find((r) => r.entity.eid == run?.map)
  let map = mapRow?.map_design ?? rows.find((r) => r.map_design)?.map_design
  if (!map?.path.length) return
  let key = JSON.stringify(map)
  if (look.mapKey != key) {
    look.mapKey = key
    buildBoard(look, map)
    for (let item of look.meshes.values()) look.actors.remove(item)
    look.meshes.clear()
    for (let p of look.puppets.values()) releasePuppet(p)
    look.puppets.clear()
    for (let bar of look.health.values()) {
      look.actors.remove(bar)
      bar.material.dispose()
    }
    look.health.clear()
  }
  let rect = look.canvas.getBoundingClientRect()
  let width = Math.max(1, Math.round(rect.width)),
    height = Math.max(1, Math.round(rect.height))
  if (width != look.width || height != look.height) {
    look.width = width
    look.height = height
    look.renderer.setSize(width, height, false)
    look.camera.aspect = width / height
    look.camera.updateProjectionMatrix()
  }
  let points = [...map.path.map(([x, , z]) => [x, z]), ...map.slots]
  let xs = points.map(([x]) => x), zs = points.map(([, z]) => z)
  let cx = (Math.min(...xs) + Math.max(...xs)) / 2
  let cz = (Math.min(...zs) + Math.max(...zs)) / 2
  let span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs),
  ) + 5.2
  let distance = span * 1.8 * Math.max(1, 0.95 / look.camera.aspect) *
    view.zoom
  let fog = look.scene.fog as THREE.Fog
  fog.near = distance + span
  fog.far = distance + span * 4
  let cameraState = {
    yaw: view.yaw,
    pitch: view.pitch,
    dist: distance,
    reach: distance,
    x: cx,
    y: 0,
    z: cz,
    shake: 0,
    snap: false,
    orbiting: false,
    lift: 0,
  }
  aim(
    cameraState,
    look.camera,
    new THREE.Vector3(cx, 0, cz),
    () => false,
    1 / 60,
  )
  look.camera.updateMatrixWorld()
  let active = new Set<string>()
  let locations = new Map<string, [number, number, number]>()
  let actor = (id: string, shape: string, boxes: Box[]) => {
    active.add(id)
    let item = look.meshes.get(id)
    if (item?.userData.shape != shape) {
      if (item) look.actors.remove(item)
      item = mesh(look, shape, boxes)
      item.userData.shape = shape
      look.meshes.set(id, item)
      look.actors.add(item)
    }
    return item!
  }
  for (let row of rows) {
    let tower = row.tower
    if (tower?.run != runId) continue
    let design = rows.find((r) => r.entity.eid == tower.design)?.tower_design
    let slot = map.slots[tower.slot]
    if (!design || !slot) continue
    let family = String(design.figure?.kind ?? design.name)
    let tier = Number(
      design.figure?.tier ?? Math.max(0, Math.round(design.cost / 100) - 1),
    )
    let color = colorOf(
      design.figure,
      /frost/i.test(family)
        ? 0x92e1ea
        : /ember/i.test(family)
        ? 0xf1a357
        : /cannon/i.test(family)
        ? 0xd7b469
        : 0xcaa168,
    )
    let item = actor(
      row.entity.eid,
      `tower/${tower.design}/${JSON.stringify(design.figure)}`,
      towerBoxes(family, tier, color),
    )
    item.position.set(slot[0], 0.13, slot[1])
    let target = rows.find((r) => r.shot?.tower == row.entity.eid)?.shot?.creep
    let creep = rows.find((r) => r.entity.eid == target)?.creep
    if (creep) {
      let to = along(map.path, creep.along)
      item.rotation.y = Math.atan2(to[0] - slot[0], to[2] - slot[1])
    }
    locations.set(row.entity.eid, [slot[0], 1.3, slot[1]])
  }
  for (let row of rows) {
    let creep = row.creep
    if (creep?.run != runId || creep.hp <= 0) continue
    let design = rows.find((r) => r.entity.eid == creep.design)?.enemy_design
    if (!design) continue
    let pace = design.speed *
      (creep.slow_until > now ? 1 - (creep.slow ?? 0.4) : 1)
    let lead = Math.max(0, Math.min(0.22, (now - creep.at) / 1000))
    let p = along(
      map.path,
      lerp(creep.along, creep.along + pace * 0.22, lead / 0.22),
    )
    let next = along(map.path, creep.along + pace * lead + 0.1)
    let family = String(design.figure?.kind ?? design.name)
    let color = colorOf(
      design.figure,
      /runner|swift|hare/i.test(family)
        ? 0xcf9c65
        : /armour|golem|iron|stone/i.test(family)
        ? 0x839b9a
        : /swarm/i.test(family)
        ? 0xa5b868
        : 0xb17d76,
    )
    active.add(row.entity.eid)
    let rig = look.puppets.get(row.entity.eid)
    if (!rig) {
      rig = puppet(enemyRig(family, color))
      rig.root.scale.setScalar(Number(design.figure?.size ?? 0.8))
      look.puppets.set(row.entity.eid, rig)
      look.meshes.set(row.entity.eid, rig.root)
      look.actors.add(rig.root)
      let bar = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: 0xe1b877, depthTest: false }),
      )
      bar.scale.set(0.7, 0.055, 1)
      look.health.set(row.entity.eid, bar)
      look.actors.add(bar)
    }
    rig.animate({
      speed: pace,
      air: false,
      swing: -1,
      hurt: 0,
      roll: -1,
      down: false,
      t: now / 1000,
    }, 1 / 60)
    let item = rig.root
    item.position.set(
      p[0],
      p[1] + 0.14 +
        Math.abs(Math.sin(now * 0.009 + hashOf(row.entity.eid))) * 0.055,
      p[2],
    )
    item.rotation.y = Math.atan2(next[0] - p[0], next[2] - p[2])
    let bar = look.health.get(row.entity.eid)
    if (bar) {
      bar.visible = creep.hp < design.hp
      bar.position.set(
        p[0],
        p[1] + Number(design.figure?.size ?? 0.8) * 1.1 + 0.4,
        p[2],
      )
      bar.scale.x = Math.max(0, creep.hp / design.hp) * 0.7
    }
    locations.set(row.entity.eid, [p[0], p[1] + 0.5, p[2]])
  }
  for (let row of rows) {
    let shot = row.shot
    if (shot?.run != runId) continue
    let tower = rows.find((r) => r.entity.eid == shot.tower)?.tower
    let creep = rows.find((r) => r.entity.eid == shot.creep)?.creep
    let slot = tower && map.slots[tower.slot]
    if (!creep || !slot) continue
    let to = along(map.path, creep.along)
    let t = Math.max(0, Math.min(1, 1 - (shot.lands - now) / 550))
    let item = actor(
      row.entity.eid,
      `shot/${shot.slow > 0}/${shot.splash > 0}`,
      [box(
        -0.09,
        -0.09,
        -0.09,
        0.18,
        0.18,
        0.18,
        shot.slow > 0 ? 0xb9f6fa : shot.splash > 0 ? 0xffbc67 : 0xffe6a9,
      )],
    )
    item.position.set(
      lerp(slot[0], to[0], t),
      lerp(1.8, 0.55, t) + Math.sin(t * Math.PI) * (shot.splash > 0 ? 2 : 0.6),
      lerp(slot[1], to[2], t),
    )
    item.rotation.set(now * 0.006, now * 0.009, 0)
  }
  for (let row of rows) {
    let player = row.player
    if (player?.run != runId || player.slot == null || now - player.at > 8000) {
      continue
    }
    let slot = map.slots[player.slot]
    if (!slot) continue
    let id = `point/${row.entity.eid}`
    active.add(id)
    let halo = look.meshes.get(id)
    if (!halo) {
      halo = ring(0x83d9d0, 0.8)
      look.meshes.set(id, halo)
      look.actors.add(halo)
    }
    halo.position.set(slot[0], 0.265, slot[1])
    halo.scale.setScalar(1.06 + Math.sin(now * 0.003) * 0.025)
  }
  for (let [id, item] of look.meshes) {
    if (active.has(id)) continue
    look.actors.remove(item)
    if (id.startsWith('point/')) {
      let halo = item as THREE.Mesh
      halo.geometry.dispose()
      ;(halo.material as THREE.Material).dispose()
    }
    look.meshes.delete(id)
    let p = look.puppets.get(id)
    if (p) releasePuppet(p)
    look.puppets.delete(id)
    let bar = look.health.get(id)
    if (bar) {
      look.actors.remove(bar)
      bar.material.dispose()
    }
    look.health.delete(id)
  }
  let slot = selectedSlot == null ? undefined : map.slots[selectedSlot]
  look.selection.visible = look.range.visible = !!slot
  if (slot) {
    look.selection.position.set(slot[0], 0.28, slot[1])
    let tower = rows.find((r) =>
      r.tower?.run == runId && r.tower.slot == selectedSlot
    )?.tower
    let range = rows.find((r) =>
      r.entity.eid == tower?.design
    )?.tower_design?.range ?? 3.5
    look.range.position.set(slot[0], 0.155, slot[1])
    look.range.scale.setScalar(range)
  }
  look.voices?.listen(ear(look.camera, [cx, 0, cz]), locations)
  look.renderer.render(look.scene, look.camera)
}

/** Build-pad picking uses stage's ray primitives, with the same camera as paint. */
export let pick = (
  look: Look,
  clientX: number,
  clientY: number,
): number | null => {
  let pads = look.board.children.filter((o) => o.name.startsWith('slot-'))
  if (!pads.length) return null
  let rect = look.canvas.getBoundingClientRect()
  let xy = cursor(
    clientX - rect.left,
    clientY - rect.top,
    rect.width,
    rect.height,
    false,
  )
  let ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2(...xy), look.camera)
  let from = ray.ray.origin, direction = ray.ray.direction
  let hit = pickRay(
    pads.map((o) => ({
      eid: o.name.slice(5),
      body: { x: o.position.x, y: 0.25, z: o.position.z },
      radius: 0.86,
    })),
    from,
    direction,
  )
  if (hit) return Number(hit.eid)
  let ground = groundRay(from, direction, () => 0.22)
  let nearest = pads.find((o) =>
    Math.hypot(o.position.x - ground.x, o.position.z - ground.z) < 0.95
  )
  return nearest ? Number(nearest.name.slice(5)) : null
}

/** A short, quiet procedural voice after a real gesture; stage owns spatialization. */
export let sound = (look: Look, kind: string, slot?: number): void => {
  if (!globalThis.AudioContext) return
  if (!look.audio) {
    look.audio = new AudioContext()
    look.voices = sources(look.audio, {
      effects: look.volume.into(look.audio, look.audio.destination),
    }, 'effects')
  }
  void look.audio.resume()
  let pitch = kind == 'sell'
    ? 220
    : kind == 'wave'
    ? 146.83
    : kind == 'upgrade'
    ? 587.33
    : 440
  let pad = slot == null
    ? undefined
    : look.board.getObjectByName(`slot-${slot}`)
  let point = pad ? [pad.position.x, pad.position.z] : undefined
  look.voices?.make(point ? [point[0], 1, point[1]] : null, {
    dur: 0.2,
    loud: 0.2,
    play: (into) => {
      let ctx = into.context, at = ctx.currentTime
      let oscillator = new OscillatorNode(ctx, {
        type: 'triangle',
        frequency: pitch,
      })
      let gain = new GainNode(ctx, { gain: 0 })
      oscillator.connect(gain).connect(into)
      gain.gain.setValueAtTime(0.001, at)
      gain.gain.exponentialRampToValueAtTime(0.15, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2)
      oscillator.frequency.exponentialRampToValueAtTime(
        pitch * (kind == 'sell' ? 0.6 : 1.5),
        at + 0.18,
      )
      oscillator.start(at)
      oscillator.stop(at + 0.21)
      oscillator.onended = () => {
        oscillator.disconnect()
        gain.disconnect()
      }
      return () => {
        oscillator.disconnect()
        gain.disconnect()
      }
    },
  }, kind)
}

export let dispose = (look: Look): void => {
  for (let g of look.geometries.values()) g.dispose()
  for (let [id, item] of look.meshes) {
    if (!id.startsWith('point/')) continue
    let halo = item as THREE.Mesh
    halo.geometry.dispose()
    ;(halo.material as THREE.Material).dispose()
  }
  for (let ring of [look.selection, look.range]) {
    ring.geometry.dispose()
    ;(ring.material as THREE.Material).dispose()
  }
  for (let p of look.puppets.values()) releasePuppet(p)
  look.puppets.clear()
  for (let bar of look.health.values()) bar.material.dispose()
  look.health.clear()
  look.scene.traverse((o) => {
    if (o instanceof THREE.DirectionalLight) o.shadow.dispose()
  })
  look.material.dispose()
  look.meshes.clear()
  look.geometries.clear()
  look.renderer.dispose()
  void look.audio?.close()
}
