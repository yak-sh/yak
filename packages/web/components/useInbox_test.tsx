// Exercise the real view hooks/transport: absence is a server answer, not an
// empty RAM cache; counts share ownership and watch/mute keeps row policy.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { cache, landSub, type Sub, useRoute } from '../live.ts'
import { uuid } from '../types.ts'
import { useInboxCount } from './useInbox.ts'

type Frame = { sub?: string; unsub?: string; q?: string }
Deno.test('inbox count waits for authority, shares holds, and switches to watch/mute rows', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!,
    actor = uuid(),
    watched = uuid(),
    instruction = uuid()
  let frames: Frame[] = []
  let restore = useRoute((frame) => frames.push(frame as Frame))
  let View = () => <span>{useInboxCount(actor) ?? '?'}</span>
  let mount = (n: number) =>
    act(() =>
      render(
        h('div', {}, Array.from({ length: n }, (_, key) => h(View, { key }))),
        root,
      )
    )
  let receive = (f: Sub) =>
    act(() => {
      landSub(f)
    })
  let asks = () => frames.filter((f) => f.sub)
  try {
    await mount(2)
    assertEquals(root.textContent, '??')
    assertEquals(asks().length, 2) // profile + standing instructions only
    let profile = asks().find((f) => f.sub!.startsWith('route:'))!
    let subscriptions = asks().find((f) =>
      f.q!.startsWith('.subscription.actor=')
    )!
    await receive({ sub: subscriptions.sub!, replace: true, changes: [] })
    assertEquals(asks().length, 2) // profile presence/email still unknown
    await receive({
      sub: profile.sub!,
      replace: true,
      changes: [
        { eid: actor, name: 'project', comp: {} },
      ],
    })
    let counts = asks().filter((f) => f.q!.endsWith('.count!'))
    assertEquals(counts.length, 5)
    assertEquals(root.textContent, '??')
    for (let f of counts) {
      await receive({ sub: f.sub!, replace: true, agg: { '': 2 } })
    }
    assertEquals(root.textContent, '1010')
    await receive({ sub: counts[0].sub!, error: 'refused' })
    assertEquals(root.textContent, '??')
    await receive({ sub: counts[0].sub!, replace: true, agg: { '': 0 } })
    assertEquals(root.textContent, '88')
    // A new watch revokes the count shortcut, without a partial-cache policy
    // decision or treating the candidate rows still in flight as a zero.
    await receive({
      sub: subscriptions.sub!,
      replace: true,
      changes: [
        {
          eid: instruction,
          name: 'subscription',
          comp: { actor, target: watched, mode: 'watch' },
        },
      ],
    })
    assertEquals(root.textContent, '??')
    assertEquals(
      frames.filter((f) => f.unsub?.startsWith('inbox-count:')).length,
      5,
    )
    let candidates = asks().filter((f) =>
      f.q!.includes('.fields=comment.target')
    )
    assertEquals(candidates.length, 7)
    let item = uuid()
    for (let f of candidates) {
      await receive({
        sub: f.sub!,
        replace: true,
        changes: f.q!.startsWith('.comment.target=')
          ? [
            { eid: item, name: 'comment', comp: { target: watched } },
          ]
          : [],
      })
    }
    assertEquals(root.textContent, '11')
    await receive({
      sub: subscriptions.sub!,
      changes: [
        { eid: instruction, name: 'subscription', comp: { mode: 'mute' } },
      ],
    })
    // Watch-derived queries change; deliver their authoritative empty sets.
    for (let f of asks().slice(asks().indexOf(candidates.at(-1)!) + 1)) {
      await receive({ sub: f.sub!, replace: true, changes: [] })
    }
    assertEquals(root.textContent, '00')
    let n = frames.filter((f) => f.unsub).length
    await mount(1)
    assertEquals(frames.filter((f) => f.unsub).length, n)
    await mount(0)
    assertEquals(asks().length, frames.filter((f) => f.unsub).length)
    await mount(1)
    assertEquals(root.textContent, '?') // retained payload is not readiness
    await mount(0)
    assertEquals(asks().length, frames.filter((f) => f.unsub).length)
  } finally {
    await act(() => render(null, root))
    useRoute(restore)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})
