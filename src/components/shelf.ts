// The per-client Shelf: graph-backed membership plus the small screen-state
// seam that opens one shelved card. The Tray renders it; any surface may put
// an entity there without depending on the Tray component.

import { signal } from '@preact/signals'
import { cache, clientId, mutate, shelfFor, topZ, uuid } from '../live.ts'
import type { Change } from '../types.ts'

export let shelfOpen = signal<string | null>(null)

export let shelfChanges = (
  client: string,
  target: string,
  view: string,
  shelf: string | undefined,
  pin = uuid(),
  z = 1,
  userAgent?: string,
): Change[] => {
  let canvas = shelf ?? uuid()
  let clientBirth: Change[] = !shelf && userAgent != null
    ? [{ eid: client, name: 'client', comp: { user_agent: userAgent } }]
    : []
  let shelfBirth: Change[] = !shelf
    ? [
      { eid: canvas, name: 'canvas', comp: {} },
      { eid: canvas, name: 'shelf', comp: { client } },
    ]
    : []
  return [
    ...clientBirth,
    ...shelfBirth,
    { eid: pin, name: 'card', comp: { target, view } },
    {
      eid: pin,
      name: 'pin',
      comp: { canvas, x: 0, y: 0, w: 0, h: 0, z },
    },
  ]
}

export let shelve = (target: string, view: string, pin?: string) => {
  let canvas = shelfFor(clientId())
  if (pin && cache.peek()[pin]?.pin) {
    let shelf = canvas ?? uuid()
    mutate(
      ...(!canvas
        ? [
          {
            eid: clientId(),
            name: 'client',
            comp: { user_agent: globalThis.navigator?.userAgent ?? '' },
          },
          { eid: shelf, name: 'canvas', comp: {} },
          { eid: shelf, name: 'shelf', comp: { client: clientId() } },
        ] satisfies Change[]
        : []),
      {
        eid: pin,
        name: 'pin',
        comp: { canvas: shelf, x: 0, y: 0, w: 0, h: 0, z: topZ(shelf) + 1 },
      },
    )
    shelfOpen.value = pin
    return pin
  }
  let made = uuid()
  mutate(
    ...shelfChanges(
      clientId(),
      target,
      view,
      canvas,
      made,
      topZ(canvas ?? '') + 1,
      globalThis.navigator?.userAgent ?? '',
    ),
  )
  shelfOpen.value = made
  return made
}

let tray: HTMLElement | null = null
export let shelfHost = (node: HTMLElement | null) => (tray = node)
export let overShelf = (x: number, y: number) => {
  if (!tray) return false
  let r = tray.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}
