import { assertEquals } from '@std/assert'
import { test, tick } from '../testing.ts'
import { h, options } from 'preact'
import { cache, config, useRoute } from '../live.ts'
import { host } from '../host_testing.ts'
import { Page } from './App.tsx'
import { mount } from './mount.ts'
import '../domain-host.tsx'
import { docs as draftDocs } from '@yaks/draft/vocab'
import { learn, vocab } from '../types.ts'
import { currentPerson, lone } from '@yaks/draft/input'

// Rendering is fixture setup; the contract is what reached the write door.
let person = 'aa000000-0000-4000-8000-000000000001'
let client = 'aa000000-0000-4000-8000-000000000002'
let eid = 'aa000000-0000-4000-8000-000000000003'
let b = {
  entity: { eid, num: 7 },
  doc: { eid, title: 'An old letter' },
}
let docs = vocab.docs
learn([...docs, ...draftDocs])
let before = config.client
let beforeHost = config.host
let fetcher = globalThis.fetch
config.host = 'reading.test'
globalThis.fetch = () =>
  Promise.resolve(Response.json([{ entity: { eid: person }, person: {} }]))
await lone()
assertEquals(currentPerson(), person)
let raf = options.requestAnimationFrame
let effects: (() => void)[] = []
options.requestAnimationFrame = (fn) => effects.push(fn)
config.client = client
let wire = host(() => ({ bundles: [b] }))
cache.value = {
  [person]: { entity: { eid: person }, person: { eid: person } },
  [client]: {
    entity: { eid: client },
    client: {
      eid: client,
      actor: person,
      user_agent: 'probe',
      ip: '127.0.0.1',
    },
  },
  [eid]: b,
}
let writes: unknown[] = []
let route = useRoute((frame) => {
  if (frame && typeof frame == 'object' && 'request' in frame) {
    writes.push(frame)
    return (frame.request as Request).clone().json().then(Response.json)
  }
})
try {
  for (let at of ['/D-7?v=Inspect.Page', '/?@page=recent']) {
    let mounted = mount(h(Page, { at }))
    try {
      while (effects.length) effects.shift()!()
      await tick()
    } finally {
      mounted.free()
    }
  }
} finally {
  wire.free()
  useRoute(route)
  config.client = before
  globalThis.fetch = () => Promise.resolve(Response.json([]))
  await lone()
  globalThis.fetch = fetcher
  config.host = beforeHost
  options.requestAnimationFrame = raf
  cache.value = {}
  learn(docs)
}

// Browsing may subscribe and keep page-local state, but may not send a durable
// mutation — including an opened mark, a draft, or a write to a listed row.
test('opening an entity and listing entities sends no writes', () => {
  assertEquals(writes, [])
})
