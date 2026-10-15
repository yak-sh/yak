// Shared geometry for the chunks now in view. A variant is prepared once
// for each visible run, and one instanced mesh draws all its placements. Pending chunks hold the shape too, so streaming a chunk away
// cannot dispose geometry another one is waiting to use.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'

type Point = [number, number, number]

export type Place = { kind: string; seed: number; turn: number; at: Point }
export type Template = (
  kind: string,
  seed: number,
  turn: number,
  near: boolean,
) => Promise<THREE.BufferGeometry>

/** A prepared placement set retains its geometry until released, even before drawing. */
export type Prepared = {
  ready: Promise<void[]>
  draw: (key: string) => void
  release: () => void
}

/** The repeated geometry currently held by chunks in a scene. */
export type Instances = {
  prepare: (placed: Place[], near: boolean) => Prepared
  drop: (key: string) => void
  invalidate: (kinds: Set<string>) => void
  dispose: () => void
}

type Batch = {
  id: string
  pending: number
  places: Map<string, Point[]>
  ready: Promise<void>
  geometry: THREE.BufferGeometry | null
  mesh: THREE.InstancedMesh | null
}

/** Templates transfer geometry ownership to the cache, which disposes it when
 * no prepared or drawn set retains it. Attribute and upload policy stay with callers. */
export let instances = (
  scene: THREE.Scene,
  material: THREE.Material,
  template: Template,
  modelKey: (kind: string, seed: number, turn: number, near: boolean) => string,
  family: (kind: string) => string,
): Instances => {
  let batches = new Map<string, Batch>()
  let chunks = new Map<string, string[]>()
  let versions = new Map<string, number>()
  let gone = false
  let key = (p: Place, near: boolean) =>
    `${modelKey(p.kind, p.seed, p.turn, near)}@${
      versions.get(family(p.kind)) ?? 0
    }`
  let forget = (b: Batch) => {
    if (b.pending || b.places.size || batches.get(b.id) != b) return
    if (b.mesh) scene.remove(b.mesh), b.mesh.dispose()
    b.geometry?.dispose()
    batches.delete(b.id)
  }
  let batch = (p: Place, near: boolean) => {
    let id = key(p, near)
    let b = batches.get(id)
    if (!b) {
      b = {
        id,
        pending: 0,
        places: new Map(),
        ready: Promise.resolve(),
        geometry: null,
        mesh: null,
      }
      let own = b
      batches.set(id, b)
      b.ready = template(p.kind, p.seed, p.turn, near).then((p) => {
        if (gone || batches.get(id) != own) {
          p.dispose()
          return
        }
        own.geometry = p
      })
    }
    b.pending++
    return b
  }
  let rebuild = (b: Batch) => {
    let places = [...b.places.values()].flat()
    if (!places.length) {
      if (b.mesh) scene.remove(b.mesh), b.mesh.dispose(), b.mesh = null
      forget(b)
      return
    }
    if (!b.geometry) return
    if (!b.mesh || b.mesh.instanceMatrix.count < places.length) {
      if (b.mesh) scene.remove(b.mesh), b.mesh.dispose()
      let capacity = 2 ** Math.ceil(Math.log2(places.length))
      b.mesh = new THREE.InstancedMesh(b.geometry, material, capacity)
      b.mesh.castShadow = b.mesh.receiveShadow = true
      b.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      scene.add(b.mesh)
    }
    let at = new THREE.Matrix4()
    places.forEach(([x, y, z], i) =>
      b.mesh!.setMatrixAt(i, at.makeTranslation(x, y, z))
    )
    b.mesh.count = places.length
    b.mesh.instanceMatrix.needsUpdate = true
    b.mesh.computeBoundingSphere()
  }
  let drop = (key: string) => {
    for (let id of chunks.get(key) ?? []) {
      let b = batches.get(id)
      if (!b) continue
      b.places.delete(key)
      rebuild(b)
    }
    chunks.delete(key)
  }
  let prepare = (placed: Place[], near: boolean) => {
    let at = new Map<string, Point[]>()
    let used = new Map<string, Batch>()
    for (let p of placed) {
      let id = key(p, near)
      let places = at.get(id)
      if (!places) {
        at.set(id, places = [])
        used.set(id, batch(p, near))
      }
      places.push(p.at)
    }
    return {
      ready: Promise.all([...used.values()].map((b) => b.ready)),
      draw: (key: string) => {
        chunks.set(key, [...at.keys()])
        for (let [id, places] of at) {
          let b = used.get(id)!
          b.places.set(key, places)
          rebuild(b)
        }
      },
      release: () => {
        for (let b of used.values()) {
          b.pending--
          forget(b)
        }
      },
    }
  }
  let dispose = () => {
    if (gone) return
    gone = true
    for (let b of batches.values()) {
      if (b.mesh) scene.remove(b.mesh), b.mesh.dispose()
      b.geometry?.dispose()
    }
    batches.clear()
    chunks.clear()
  }
  let invalidate = (kinds: Set<string>) => {
    for (let kind of kinds) versions.set(kind, (versions.get(kind) ?? 0) + 1)
  }
  return { prepare, drop, invalidate, dispose }
}
