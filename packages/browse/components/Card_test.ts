// A card's reactive style follows graph moves and its narrow stacking signal.
import { test } from '../testing.ts'
import { computed, signal } from '@preact/signals-core'
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

test('card style follows moved coordinates without a z change', () => {
  cache.value = {
    'card-style': {
      pin: pin(10, 20, 1),
      card: { eid: 'card-style', target: 'target', view: 'Full' },
    },
  }
  let live = signal(pin(10, 20, 1))
  let style = computed(() => pinStyle(live.value))

  let position = () => {
    let { left, top, zIndex } = style.value
    return [left, top, zIndex]
  }
  assertEquals(position(), ['10px', '20px', 1])
  live.value = pin(30, 40, 1)
  assertEquals(position(), ['30px', '40px', 1])

  applyLocal([{
    eid: 'card-style',
    name: 'pin',
    comp: { z: 2 },
  }])
  assertEquals(position(), ['30px', '40px', 2])
})
