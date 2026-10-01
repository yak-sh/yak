// No figure draws two faces the depth buffer cannot tell apart (mesh.ts
// `fights`): not within a part, and not between two parts standing square to
// each other as it is built. Every creature, the people who give quests, and
// heroes in each weight of armour with each weapon.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import * as THREE from 'three'
import { HANDLES, WEIGHTS } from './arms.ts'
import { BEASTS } from './beasts.ts'
import { beast, BUILD, CHILD, hero, person, type Puppet } from './figures.ts'
import { fights, type Out, out, pack, place } from './mesh.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let parts = (f: Puppet) => {
  let got: THREE.Bone[] = []
  f.root.traverse((o) => {
    if (o instanceof THREE.Bone && o.userData.part) got.push(o)
  })
  return got
}

// Part `b` in part `a`'s space, when the two are turned square to each other.
let beside = (a: THREE.Bone, b: THREE.Bone): Out | null => {
  let m = a.matrixWorld.clone().invert().multiply(b.matrixWorld)
  let turn = new THREE.Matrix3().setFromMatrix4(m)
  let e = turn.elements
  for (let c = 0; c < 9; c += 3) {
    let n = Math.hypot(e[c], e[c + 1], e[c + 2])
    if (
      [e[c], e[c + 1], e[c + 2]].filter((x) => Math.abs(x) > n * 1e-6).length !=
        1
    ) {
      return null
    }
  }
  let o: Out = { ...b.userData.part, pos: [], nrm: [] }
  let v = new THREE.Vector3(), from: Out = b.userData.part
  for (let i = 0; i < from.pos.length; i += 3) {
    v.fromArray(from.pos, i).applyMatrix4(m)
    o.pos.push(v.x, v.y, v.z)
  }
  for (let i = 0; i < from.nrm.length; i += 4) {
    v.fromArray(from.nrm, i).applyMatrix3(turn).normalize()
    o.nrm.push(Math.round(v.x), Math.round(v.y), Math.round(v.z), 0)
  }
  return o
}

// How many pairs of `f`'s faces fight: within a part, or looking the same way
// from two parts.
let clashes = (f: Puppet) => {
  let ps = parts(f)
  let n = ps.reduce((n, p) => n + fights(pack(p.userData.part)).length, 0)
  for (let [i, a] of ps.entries()) {
    for (let b of ps.slice(i + 1)) {
      let there = beside(a, b)
      if (!there) continue
      let both = out()
      place(both, a.userData.part, [0, 0, 0])
      let mine = both.pos.length / 12
      place(both, there, [0, 0, 0])
      let facing = (q: number) => both.nrm.slice(q * 16, q * 16 + 3).join()
      n += fights(pack(both)).filter(([x, y]) =>
        x < mine && y >= mine && facing(x) == facing(y)
      ).length
    }
  }
  return n
}

// Every figure `made` that fights, with how many pairs of faces.
let fighting = (made: Record<string, () => Puppet>) =>
  Object.fromEntries(
    Object.entries(made)
      .map(([name, f]) => [name, clashes(f())])
      .filter(([, n]) => n),
  )

let look = { tint: '#4a7ab8', hair: '#6a4a30', skin: '#e8c0a0' }

test('no creature fights itself', () => {
  assertEquals(
    fighting(Object.fromEntries(
      Object.values(BEASTS).map((b) => [b.name, () => beast(b.eid)]),
    )),
    {},
  )
})

test('no hero fights what they wear, grown or a child', () => {
  let offs = ['shield1', 'torch1', 'tome1', 'dagger1']
  let made: Record<string, () => Puppet> = {}
  for (let [build, b] of Object.entries({ grown: BUILD, child: CHILD })) {
    for (let [weight, w] of Object.entries(WEIGHTS)) {
      for (let [i, family] of Object.keys(HANDLES).entries()) {
        let dress = {
          head: `${w.head}3`,
          body: `${w.body}3`,
          feet: `${w.feet}3`,
          main: family == 'fists' ? undefined : `${family}3`,
          off: offs[i % offs.length],
          trinket: 'ring3',
        }
        made[`${build} ${weight} ${family}`] = () => hero(b, look, dress)
      }
    }
    made[`${build} villager`] = () => person(b, look)
    made[`${build} elder`] = () => person(b, look, true)
  }
  assertEquals(fighting(made), {})
})
