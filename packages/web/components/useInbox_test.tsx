// Exercise the real view hooks/transport: absence is a server answer, not an
// empty RAM cache; counts share ownership and watch/mute keeps row policy.
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import type { Frame } from '@yaks/sync'
import { cache } from '../live.ts'
import { host } from '../host_testing.ts'
import { uuid } from '../types.ts'
import { useInboxCount } from './useInbox.ts'

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
  cache.value = {}
  let wire = host()
  let View = () => <span>{useInboxCount(actor) ?? '?'}</span>
  let mount = (n: number) =>
    act(() =>
      render(
        h('div', {}, Array.from({ length: n }, (_, key) => h(View, { key }))),
        root,
      )
    )
  let say = (f: Frame) => act(() => wire.say(f))
  let asks = () => wire.asked()
  let gone = () =>
    wire.sent.flatMap((m) => m.unsubscribe ? [m.unsubscribe] : [])
  let standing = (mode: string) => ({
    entity: { eid: instruction },
    subscription: { actor, target: watched, mode },
  })
  try {
    await mount(2)
    assertEquals(root.textContent, '??')
    assertEquals(asks().length, 2) // profile + standing instructions only
    let subscriptions = asks().find((a) =>
      a.subscribe.startsWith('.subscription.actor=')
    )!
    let profile = asks().find((a) => a != subscriptions)!
    await say({ id: subscriptions.id, bundles: [] })
    assertEquals(asks().length, 2) // profile presence/email still unknown
    await say({
      id: profile.id,
      bundles: [{ entity: { eid: actor }, project: {} }],
    })
    let counts = asks().filter((a) => a.subscribe.endsWith('.count'))
    assertEquals(counts.length, 4)
    assertEquals(root.textContent, '??')
    for (let a of counts) await say({ id: a.id, count: 2 })
    assertEquals(root.textContent, '88')
    await say({
      id: counts[0].id,
      refused: { error: 'read', message: 'refused' },
    })
    assertEquals(root.textContent, '??')
    await say({ id: counts[0].id, count: 0 })
    assertEquals(root.textContent, '66')
    // A new watch revokes the count shortcut, without a partial-cache policy
    // decision or treating the candidate rows still in flight as a zero.
    await say({ id: subscriptions.id, bundles: [standing('watch')] })
    assertEquals(root.textContent, '??')
    assertEquals(counts.every((a) => gone().includes(a.id)), true)
    let candidates = asks().filter((a) =>
      a.subscribe.includes('!archived') && !a.subscribe.endsWith('.count')
    )
    assertEquals(candidates.length > 0, true)
    let item = uuid()
    for (let a of candidates) {
      await say({
        id: a.id,
        bundles: a.subscribe.startsWith('.comment.target=')
          ? [{ entity: { eid: item }, comment: { target: watched } }]
          : [],
      })
    }
    assertEquals(root.textContent, '11')
    await say({ id: subscriptions.id, bundles: [standing('mute')] })
    // Watch-derived queries change; deliver their authoritative empty sets.
    for (let a of asks().slice(asks().indexOf(candidates.at(-1)!) + 1)) {
      await say({ id: a.id, bundles: [] })
    }
    assertEquals(root.textContent, '00')
    let n = gone().length
    await mount(1)
    assertEquals(gone().length, n)
    await mount(0)
    assertEquals(asks().length, gone().length)
    await mount(1)
    assertEquals(root.textContent, '?') // retained payload is not readiness
    await mount(0)
    assertEquals(asks().length, gone().length)
  } finally {
    await act(() => render(null, root))
    wire.free()
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})
