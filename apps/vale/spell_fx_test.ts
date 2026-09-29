// Elemental cues through the particle interface used by the scene.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type bits } from './fx.ts'
import { spellFx } from './spell_fx.ts'

type Call = Parameters<ReturnType<typeof bits>['emit']>
let pool = () => {
  let calls: Call[] = []
  return {
    calls,
    emit: (...args: Call) => {
      calls.push(args)
    },
  }
}

test('earth falls as ground chips while light and life rise differently', () => {
  let dust = pool(), glow = pool()
  let fx = spellFx(dust, glow)
  let at = new THREE.Vector3(0, 0, 0)
  fx.cast('earth', at, 3)
  assertEquals(glow.calls.length, 0)
  assert(
    dust.calls.every(([p, , , o]) =>
      Math.hypot(p.x, p.z) > 2.9 && (o?.fall ?? 0) > 0
    ),
  )
  dust.calls.length = 0
  fx.cast('light', at)
  let light = glow.calls.map(([, color]) => color)
  assert(glow.calls.some(([, , , o]) => o?.halo))
  glow.calls.length = 0
  fx.cast('life', at)
  assert(glow.calls.every(([, , , o]) => (o?.up ?? 0) > 1))
  assert(glow.calls.some(([, color]) => !light.includes(color)))
  assertEquals(dust.calls.length, 0)
})

test('shadow connects both ends of a step and bursts at its hit', () => {
  let dust = pool(), glow = pool()
  let fx = spellFx(dust, glow)
  let from = new THREE.Vector3(0, 0, 0)
  let to = new THREE.Vector3(8, 0, 0)
  fx.travel('shadow', from, to)
  assert(glow.calls.some(([p]) => p.x < 0.1))
  assert(glow.calls.some(([p]) => p.x > 7.9))
  let before = glow.calls.length
  fx.hit('shadow', to)
  assert(glow.calls.length > before)
  assertEquals(dust.calls.length, 0)
})

test('existing fire has one visual owner', () => {
  let dust = pool(), glow = pool()
  let fx = spellFx(dust, glow)
  let at = new THREE.Vector3()
  fx.cast('fire', at)
  fx.hit('fire', at)
  fx.travel('fire', at, at)
  assertEquals(dust.calls.length + glow.calls.length, 0)
})
