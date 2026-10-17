import { assertEquals } from '@std/assert'
import { test, tick } from '../testing.ts'
import { h, options, render } from 'preact'
import { cache, config } from '../live.ts'
import { host } from '../host_testing.ts'
import { Page } from './App.tsx'
import { mount } from './mount.ts'
import '../domain-host.tsx'

// Load a human address before its canonical row exists, then update the row
// through the same answer. The page must keep that subscription ready.
let observed = await (async () => {
  let beforeHost = config.host, raf = options.requestAnimationFrame
  let effects: (() => void)[] = []
  options.requestAnimationFrame = (fn) => effects.push(fn)
  config.host = 'alias-page.test'
  cache.value = {}
  let canonical = 'bb000000-0000-4000-8000-000000000077'
  let b = {
    entity: { eid: canonical, num: 70124 },
    doc: { title: 'Alias first' },
  }
  let wire = host((a) =>
    a.subscribe.includes('D-70124') ? { bundles: [b] } : undefined
  )
  let mounted = mount(h(Page, { at: '/D-70124' }))
  let flush = async () => {
    while (effects.length) effects.shift()!()
    await tick()
  }
  try {
    await flush()
    await flush()
    let asks = wire.asked().filter((a) =>
      a.subscribe.startsWith('.entity.eid=')
    )
    let root = asks.find((a) => a.subscribe.includes('D-70124'))!
    let stable = !wire.sent.some((a) => a.unsubscribe == root.id)
    await wire.say({
      id: root.id,
      bundles: [{ entity: b.entity, doc: { title: 'Alias updated' } }],
    })
    await flush()
    let updated = mounted.root.querySelector('.Show_Title')?.textContent
    // A different path to the same cached row is a new addressed lifetime.
    render(h(Page, { at: `/${canonical}` }), mounted.root)
    await flush()
    await flush()
    let canonicalAsk = wire.asked().find((a) =>
      a.subscribe.startsWith(`.entity.eid=${canonical}`)
    )
    let switched = !!canonicalAsk &&
      wire.sent.some((a) => a.unsubscribe == root.id)
    if (canonicalAsk) await wire.say({ id: canonicalAsk.id, bundles: [b] })
    await flush()
    if (canonicalAsk) {
      await wire.say({ id: canonicalAsk.id, bundles: [], reset: true })
    }
    await flush()
    let gone = !mounted.root.querySelector('.Show_Title')
    return { stable, updated: updated?.trim(), switched, gone }
  } finally {
    mounted.free()
    wire.free()
    config.host = beforeHost
    options.requestAnimationFrame = raf
    cache.value = {}
  }
})()

test('a page keeps its addressed root ready and changes holds with the path', () => {
  assertEquals(observed, {
    stable: true,
    updated: 'Alias updated',
    switched: true,
    gone: true,
  })
})
