// Entity links share one peek state: opening, marking, and closing are one seam.
import { assertEquals } from '@std/assert'
import { type Ent } from '../types.ts'
import { clickProps, openAt, peek } from './nav.tsx'

let e: Ent = {
  eid: 'task',
  num: 7,
  kind: 'task',
  refs: [],
  kids: [],
}

let ev = { clientX: 12, clientY: 34 } as MouseEvent

Deno.test('clicking the open peek link closes it', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  Object.defineProperty(globalThis, 'matchMedia', {
    value: () => ({ matches: true }),
    configurable: true,
  })
  try {
    peek.value = null

    openAt(e.eid, ev)
    assertEquals(peek.value, { eid: 'task', x: 12, y: 34 })
    assertEquals(clickProps(e)['data-peek'], 'open')

    openAt(e.eid, ev)
    assertEquals(peek.value, null)
    assertEquals(clickProps(e)['data-peek'], undefined)
  } finally {
    if (prior) Object.defineProperty(globalThis, 'matchMedia', prior)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
  }
})
