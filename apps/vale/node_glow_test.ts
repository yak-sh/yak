// Rare resource motes as the scene's particle pool receives them.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { assert, assertEquals } from '@std/assert'
import { LODES } from './gather.ts'
import { nodeGlow } from './node_glow.ts'
import type { Rarity } from './rarity.ts'
import type { Seen } from './work.ts'

let node = (rarity: Rarity, i = 0): Seen => ({
  eid: `node-${i}`,
  kind: 'copper',
  lode: LODES.copper,
  name: 'Copper',
  at: [i, 0, 0],
  life: 0,
  spent: false,
  near: 18 + i * 0.01,
  rarity,
})

let run = (nodes: Seen[], phone = false) => {
  let scene = new THREE.Scene()
  let emitted: {
    at: THREE.Vector3
    options: {
      size?: number
      halo?: boolean
      flame?: boolean
    }
  }[] = []
  let light = nodeGlow(scene, {
    emit: (at, _color, _n, options) =>
      emitted.push({ at, options: options ?? {} }),
  }, phone)
  for (let i = 0; i < 10; i++) {
    light.begin(nodes)
    for (let n of nodes) light.show(n, new THREE.Vector3(...n.at), 0.1, i)
    light.end()
  }
  return { scene, emitted, light }
}

Deno.test('finer resources send more visible, distinct moving motes', () => {
  let tiers = ['uncommon', 'rare', 'epic', 'legendary'] as const
  let outputs = tiers.map((rarity) => run([node(rarity)]))
  let counts = outputs.map((o) => o.emitted.length)
  assert(counts[0] > 2)
  assert(counts.every((n, i) => i == 0 || n > counts[i - 1]))
  let sizes = outputs.map((o) =>
    Math.max(...o.emitted.map((e) => e.options.size ?? 0))
  )
  assert(sizes.every((n, i) => i == 0 || n > sizes[i - 1]))
  assert(outputs[2].emitted.some((e) => e.options.halo))
  assert(outputs[3].emitted.some((e) => e.options.flame))
  assert(outputs[3].emitted.some((e) => !e.options.flame))
  assert(outputs[0].emitted.every((e) => !e.options.flame))
  assert(new Set(outputs[3].emitted.map((e) => e.at.x)).size > 1)
  for (let o of outputs) o.light.dispose()
})

Deno.test('phone mote work stays bounded and spent resources go quiet', () => {
  let nodes = Array.from({ length: 25 }, (_, i) => node('legendary', i))
  let { scene, emitted, light } = run(nodes, true)
  assert(emitted.length <= 60)
  let before = emitted.length
  nodes.forEach((n) => n.spent = true)
  light.begin(nodes)
  for (let n of nodes) light.show(n, new THREE.Vector3(...n.at), 0.1, 11)
  light.end()
  assertEquals(emitted.length, before)
  assertEquals(scene.children, [])
  light.dispose()
})
