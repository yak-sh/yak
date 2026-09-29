// Equipped magic stays lit in the hero's hands through the figure render door.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { assertEquals } from '@std/assert'
import { BUILD, hero } from './figures.ts'
import { ITEMS } from './items.ts'
import { seedItems } from './items_fixture.ts'

seedItems()

Deno.test('a staff and tome carry their own soft light', () => {
  let f = hero(BUILD, { tint: '#668866', hair: '#443322', skin: '#ddbb99' }, {
    main: 'staff2',
    off: 'tome2',
  })
  let lights: THREE.Sprite[] = []
  f.root.traverse((o) => {
    if (o instanceof THREE.Sprite) lights.push(o)
  })
  assertEquals(lights.length, 2)
  assertEquals(lights[0].material.map, lights[1].material.map)
  assertEquals(lights.map((s) => s.material.color.getHex()), [
    ITEMS.staff2.aura?.color,
    ITEMS.tome2.aura?.color,
  ])
  assertEquals(lights.every((s) => s.parent instanceof THREE.Bone), true)
  assertEquals(
    lights.every((s) =>
      s.material.blending == THREE.AdditiveBlending && !s.material.depthWrite
    ),
    true,
  )
})
