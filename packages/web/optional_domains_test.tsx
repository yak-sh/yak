import { test } from '@yaks/testing'
import { tick } from './testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { learn, vocab } from './types.ts'
import { cache, config, ent, problem } from './live.ts'
import { hostCommands } from './host_commands.ts'
import { actionsFor } from './components/registry.ts'
import { Entity } from './components/Entity.tsx'
import { useCommentsOn, useReferences } from './components/useQuery.ts'
import { useSessions } from './components/useSessions.ts'
import { Navigation } from './components/Navigation.tsx'
import { mount } from './components/mount.ts'
import { host } from './host_testing.ts'
import { Web } from './components/views/Web.tsx'
import { pasted } from './paste.ts'
import { sessionQueries } from './tray_query.ts'

let docs = vocab.docs
let minimal = () =>
  docs.map((doc) => ({
    ...doc,
    $defs: Object.fromEntries(
      Object.entries(doc.$defs ?? {}).filter(([name]) =>
        ['entity', 'doc', 'created', 'updated'].includes(name)
      ),
    ),
  }))

test('a document-only vocabulary browses without task, session or box-only reads and verbs', async () => {
  learn(minimal())
  problem.value = ''
  let priorHost = config.host
  config.host = 'optional.test'
  cache.value = {
    document: {
      entity: { eid: 'document', num: 1 },
      doc: { title: 'App document', body: 'Its own words' },
    },
  }
  let wire = host(() => ({ bundles: [] }))
  let View = () => {
    useSessions()
    useCommentsOn('document')
    useReferences('document')
    return h('div', {}, h(Navigation, {}), h(Entity, { eid: 'document' }))
  }
  let seen = mount(h(View, {}))
  try {
    await tick()
    assertEquals(seen.root.textContent?.includes('App document'), true)
    assertEquals(seen.root.textContent?.includes('All sessions'), false)
    assertEquals(wire.asked().length, 0)
    assertEquals(problem.value, '')
    assertEquals(seen.root.textContent?.includes('ReferenceError'), false)
    let offered = hostCommands(vocab)
    for (
      let name of ['new', 'fix', 'chat', 'task', 'session', 'claim', 'mail']
    ) {
      assertEquals(name in offered, false, name)
    }
    for (let name of ['open', 'set', 'delete', 'doc']) {
      assertEquals(name in offered, true, name)
    }
    assertEquals(
      actionsFor(ent('document')).some((a) => a.label == 'show in navigation'),
      false,
    )
  } finally {
    seen.free()
    wire.free()
    config.host = priorHost
    learn(docs)
    cache.value = {}
  }
})

test('legacy freeze is not offered or scheduled without a host door', () => {
  let prior = globalThis.setTimeout
  let scheduled = 0
  globalThis.setTimeout = (() => {
    scheduled++
    return 0
  }) as typeof setTimeout
  try {
    let spec = pasted('https://example.com/a')!
    assertEquals(spec.changes.map((c) => c.name), ['web'])
    assertEquals(scheduled, 0)
    let seen = mount(h(Web, {
      e: { eid: spec.target, web: { url: 'https://example.com/a' } },
    }))
    try {
      assertEquals(
        seen.root.textContent?.includes('https://example.com/a'),
        true,
      )
      assertEquals(seen.root.querySelector('button'), null)
      assertEquals(seen.root.textContent?.includes('freezing'), false)
    } finally {
      seen.free()
    }
  } finally {
    globalThis.setTimeout = prior
  }
})

test('hosted transcript chrome omits box-only processes and projections', () => {
  let machine = new Set(['process', 'exit', 'spawned', 'brief'])
  learn(docs.map((doc) => ({
    ...doc,
    $defs: Object.fromEntries(
      Object.entries(doc.$defs ?? {}).filter(([name]) => !machine.has(name)),
    ),
  })))
  try {
    let query = sessionQueries(vocab)
    assertEquals(query.process, '')
    for (let line of [query.active, query.recent, query.detail, query.all]) {
      assertEquals(/\.(process|exit|spawned|brief)\b/.test(line), false, line)
    }
    assertEquals(query.recent.includes('.session'), true)
  } finally {
    learn(docs)
  }
})
