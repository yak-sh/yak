// Query ownership lives at view roots. Exercise the real hooks and transport,
// including overlapping mounts, retargeting, and reads between cleanup/mount.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { backlinks, boardsOver, cache, chatFor, useRoute } from '../live.ts'
import { slow } from '../testing.ts'
import { useBacklinks, useBoardsOver, useChatFor } from './useQuery.ts'

let A = 'dddd3703-0000-4000-8000-000000000001'
let B = 'dddd3703-0000-4000-8000-000000000002'
let actor = 'dddd3703-0000-4000-8000-000000000003'
type Frame = { sub?: string; unsub?: string; q?: string }

slow('eid-keyed view queries release on retarget and last unmount', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let frames: Frame[] = []
  let restore = useRoute((frame) => frames.push(frame as Frame))
  let probe = (globalThis as unknown as { __probe: { subN(): number } }).__probe
  let baseline = probe.subN()
  let View = ({ target, who }: { target: string; who?: string }) => {
    useBoardsOver(target)
    useChatFor(who, target)
    useBacklinks(target)
    return null
  }
  let mount = (targets: string[], who: string | undefined = actor) =>
    act(() =>
      render(
        h(
          'div',
          {},
          targets.map((target, i) => h(View, { key: i, target, who })),
        ),
        root,
      )
    )
  try {
    mount([A, A])
    assertEquals(probe.subN(), baseline + 3)
    assertEquals(frames.filter((f) => f.sub).length, 3)
    mount([A])
    assertEquals(frames.filter((f) => f.unsub).length, 0)
    mount([B])
    assertEquals(probe.subN(), baseline + 3)
    assertEquals(frames.filter((f) => f.sub).length, 6)
    assertEquals(frames.filter((f) => f.unsub).length, 3)
    mount([B], '')
    assertEquals(probe.subN(), baseline + 2)
    mount([])
    assertEquals(probe.subN(), baseline)
    let n = frames.length
    // A late imperative read cannot reopen what its view just released.
    backlinks(B)
    boardsOver(B)
    chatFor(actor, B)
    assertEquals(frames.length, n)
    // The same card can open again, with exactly one open/close per shape.
    mount([A])
    mount([])
    assertEquals(probe.subN(), baseline)
    assertEquals(frames.filter((f) => f.sub).length, 9)
    assertEquals(frames.filter((f) => f.unsub).length, 9)
  } finally {
    act(() => render(null, root))
    useRoute(restore)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})
