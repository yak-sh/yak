// A card's reactive style follows graph moves and its narrow stacking signal.
import { computed, signal } from '@preact/signals'
import { assertEquals } from '@std/assert'
import { applyLocal, cache } from '../live.ts'
import { pinStyle } from './Card.tsx'

let pin = (x: number, y: number, z: number) => ({
  eid: 'card-style',
  canvas: 'canvas',
  target: 'target',
  view: 'Full',
  x,
  y,
  w: 0,
  h: 0,
  z,
})

Deno.test('card style follows moved coordinates without a z change', () => {
  cache.value = {
    'card-style': {
      pin: pin(10, 20, 1),
      card: { eid: 'card-style', target: 'target', view: 'Full' },
    },
  }
  let live = signal(pin(10, 20, 1))
  let style = computed(() => pinStyle(live))

  assertEquals(style.value, 'left:10px;top:20px;z-index:1;')
  live.value = pin(30, 40, 1)
  assertEquals(style.value, 'left:30px;top:40px;z-index:1;')

  applyLocal([{
    eid: 'card-style',
    name: 'pin',
    comp: { z: 2 },
  }])
  assertEquals(style.value, 'left:30px;top:40px;z-index:2;')
})
