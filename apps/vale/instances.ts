// Shared building shapes for the chunks now in view. A variant is meshed in
// a worker once for each visible run, and one instanced mesh draws all its
// placements. Pending chunks hold the shape too, so streaming a chunk away
// cannot dispose geometry another one is waiting to use.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Chunk } from './chunks.ts'
import type { Packed, Vec } from './mesh.ts'
import { modelKey } from './props.ts'
import { geometry } from './soft.ts'

type Place = Chunk['buildings'][number]
type Template = (
  kind: string,
  seed: number,
  turn: number,
  near: boolean,
) => Promise<Packed>

type Batch = {
  id: string
  pending: number
  places: Map<string, Vec[]>
  ready: Promise<void>
  geometry: THREE.BufferGeometry | null
  mesh: THREE.InstancedMesh | null
}

let bytes = (p: Packed) =>
  Object.values(p).reduce((n, a) => n + a.byteLength, 0)

let release = (a: THREE.BufferAttribute) =>
  a.onUpload(() => a.array = a.array.slice(0, 0))

export let instances = (
  scene: THREE.Scene,
  material: THREE.Material,
  template: Template,
) => {
  let batches = new Map<string, Batch>()
  let chunks = new Map<string, string[]>()
  let gone = false
  let forget = (b: Batch) => {
    if (b.pending || b.places.size || batches.get(b.id) != b) return
    if (b.mesh) scene.remove(b.mesh), b.mesh.dispose()
    b.geometry?.dispose()
    batches.delete(b.id)
  }
  let batch = (p: Place, near: boolean) => {
    let id = modelKey(p.kind, p.seed, p.turn, near)
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
        if (gone || batches.get(id) != own) return
        own.geometry = geometry(p)
        own.geometry.userData.bytes = bytes(p)
        for (let a of Object.values(own.geometry.attributes)) {
          if (a instanceof THREE.BufferAttribute) release(a)
        }
        if (own.geometry.index) release(own.geometry.index)
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
    let at = new Map<string, Vec[]>()
    let used = new Map<string, Batch>()
    for (let p of placed) {
      let id = modelKey(p.kind, p.seed, p.turn, near)
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
  return { prepare, drop, dispose }
}
