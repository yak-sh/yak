// Readiness, shared query ownership, thread counts and watch/mute over the wire.
import { test, until } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { cache } from '../live.ts'
import { host, reader } from '../host_testing.ts'
import { uuid } from '../types.ts'
import { useInboxCount } from './useInbox.ts'

let at = (n: number) => `2026-10-02T12:00:0${n}.000Z`
test('inbox counts wait for complete reads, share holds, deduplicate and respect watch/mute', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let actor = uuid(),
    target = uuid(),
    mine = uuid(),
    watched = uuid(),
    sub = uuid()
  let data: Bundle[] = [
    { entity: { eid: actor }, person: {}, email: { address: 'p@example.com' } },
    {
      entity: { eid: target },
      task: {},
      doc: { title: 'Thread' },
      created: { at: at(1) },
    },
    {
      entity: { eid: mine },
      comment: { target },
      doc: { body: 'What now?' },
      created: { by: actor, at: at(2) },
    },
    ...[3, 4].map((n) => ({
      entity: { eid: uuid() },
      comment: { target, reply_to: mine },
      doc: { body: 'Answer' },
      created: { at: at(n) },
    })),
    { entity: { eid: watched }, task: {}, completed: { at: at(5) } },
  ]
  cache.value = {}
  let answering = false
  let wire = host((a) =>
    answering ? { bundles: reader(data)(a.subscribe) } : undefined
  )
  let View = () => <span>{useInboxCount(actor) ?? '?'}</span>
  let mount = (n: number) =>
    act(() =>
      render(
        h('div', {}, Array.from({ length: n }, (_, key) => h(View, { key }))),
        root,
      )
    )
  let wait = (text: string) =>
    until(async () => {
      await act(() => Promise.resolve())
      return root.textContent == text
    })
  try {
    await mount(2)
    assertEquals(root.textContent, '??')
    answering = true
    for (let a of wire.asked()) {
      await act(() =>
        wire.say({ id: a.id, bundles: reader(data)(a.subscribe) })
      )
    }
    await wait('11') // two answers, one thread
    let seed = wire.asked().find((a) => a.subscribe.includes('.created.by='))!
    await act(() =>
      wire.say({ id: seed.id, refused: { error: 'read', message: 'denied' } })
    )
    assertEquals(root.textContent, '??')
    await act(() =>
      wire.say({
        id: seed.id,
        bundles: reader(data)(seed.subscribe),
        reset: true,
      })
    )
    await wait('11')
    let subscriptions = wire.asked().find((a) =>
      a.subscribe.startsWith('.subscription.actor=')
    )!
    data.push({
      entity: { eid: sub },
      subscription: { actor, target: watched, mode: 'watch' },
    })
    await act(() =>
      wire.say({
        id: subscriptions.id,
        bundles: reader(data)(subscriptions.subscribe),
      })
    )
    await wait('22')
    data.at(-1)!.subscription = { actor, target: watched, mode: 'mute' }
    await act(() =>
      wire.say({
        id: subscriptions.id,
        bundles: reader(data)(subscriptions.subscribe),
      })
    )
    await wait('11')
    let asks = wire.asked().length
    await mount(1)
    assertEquals(wire.asked().length, asks)
    await mount(0)
    assertEquals(wire.sent.filter((m) => m.unsubscribe).length, asks)
  } finally {
    await act(() => render(null, root))
    wire.free()
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})
