import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { effects } from '@yaks/effects'
import { loadVocab } from '@yaks/vocab'
import type { NamedTool, Plugin as GraphPlugin } from '@yaks/graph'
import { workerAnatomy } from './anatomy.ts'

let words = loadVocab([{
  package: 'fixture',
  $defs: {
    note: { component: true, properties: { text: { type: 'string' } } },
    note_seen: { effect: true, created: ['note'] },
    note_list: { tool: true, description: 'List notes', input: {} },
  },
}])

let effectWords = loadVocab([{
  package: 'fixture',
  $defs: {
    note: { component: true, properties: {} },
    note_seen: { effect: true, created: ['note'] },
  },
}])

let tool: NamedTool = {
  name: 'note_list',
  description: 'List notes',
  inputSchema: { type: 'object', properties: {} },
  run: () => [],
}

test('worker anatomy is per-store composition, not a native or connector roster', () => {
  let count = 0
  let guarded: GraphPlugin = {
    name: 'guarded',
    resources: {
      Env: () => {
        count++
        return { TOKEN: 'never' }
      },
    },
    hooks: {
      admit: (bundles) => {
        count++
        return bundles
      },
    },
  }
  let app = workerAnatomy({ plugins: ['fixture'] })
  let directory = workerAnatomy({ plugins: ['directory'] })
  app.composition.declarations(words.docs, words)
  directory.composition.declarations(words.docs, words)
  app.composition.loaded('fixture', 'graph', true)
  directory.composition.loaded('directory', 'graph', true)
  app.composition.graph('fixture', [guarded])
  let domain: GraphPlugin = {
    name: 'domain',
    rules: [{
      name: 'declared_rule',
      phase: 'rules',
      match: '.note',
      produce: { note: { text: 'not serialized' } },
    }],
  }
  app.graph([guarded, domain])
  directory.graph([{
    name: 'directory',
    hooks: { commit: (bundles) => bundles },
  }])
  app.commands({
    note_list: {
      description: 'List notes',
      input: {},
      query: '.note',
    },
  }, [tool])
  let first = app.read(), second = directory.read()
  assertEquals(first.scope, 'worker')
  assertEquals(first.host, 'worker/store')
  assertEquals(
    first.packages.find((p) => p.name == 'fixture')?.configured,
    true,
  )
  assert(!first.packages.some((p) => p.name == 'guarded'))
  assertEquals(first.hooks.filter((h) => h.name == 'guarded:admit').length, 1)
  assertEquals(
    first.hooks.find((h) => h.name == 'guarded:admit')?.package,
    'fixture',
  )
  assert(!second.packages.some((p) => p.name == 'guarded'))
  assert(first.packages.some((p) => p.name == 'domain'))
  assertEquals(first.commands.map((c) => c.name), ['note_list'])
  assertEquals(first.tools.find((t) => t.name == 'note_list')?.bound, true)
  assertEquals(second.tools.find((t) => t.name == 'note_list')?.loaded, false)
  assertEquals(first.observed?.routes, false)
  assertEquals(first.observed?.secrets, false)
  assertEquals(first.observed?.views, false)
  assertEquals(first.observed?.skills, false)
  assertEquals(first.secrets, [])
  assertEquals(count, 0)
  let wire = JSON.stringify(first)
  assert(!wire.includes('TOKEN'))
  assert(!wire.includes('never'))
  assert(!wire.includes('produce'))
  assertStringIncludes(wire, 'Env')
  first.tools.length = 0
  assert(app.read().tools.length > 0)
})

test('worker effect ownership observes registration once, never replays callbacks', () => {
  let registry = effects(effectWords)
  let capture = workerAnatomy({})
  capture.composition.declarations(effectWords.docs, effectWords)
  capture.graph([])
  let calls = 0, runs = 0
  let made = () => {
    calls++
    registry.handle({
      note_seen: () => {
        runs++
      },
    })
    registry.on('note', {
      created: () => {
        runs++
      },
      doc: 'Observe a note',
    })
  }
  let done = capture.registration('domain', registry)
  made()
  done()
  capture.effects(registry.slots())
  let first = capture.read(), again = capture.read()
  assertEquals(calls, 1)
  assertEquals(runs, 0)
  let declared = first.effects.find((e) => e.name == 'note_seen')!
  assertEquals([declared.declared, declared.loaded, declared.bound], [
    true,
    true,
    true,
  ])
  assertEquals(declared.handler, 'domain')
  let observer = first.effects.find((e) => e.registration)!
  assertEquals(observer.package, 'domain')
  assertEquals(observer.triggers, { kind: 'created', comp: 'note' })
  assertEquals(observer.description, 'Observe a note')
  assertEquals(first.effects.map((e) => e.id), again.effects.map((e) => e.id))
  assert(!JSON.stringify(first).includes('"run":'))
})

test('worker command replacement updates loading evidence without invoking a run', () => {
  let capture = workerAnatomy({})
  capture.composition.declarations(words.docs, words)
  capture.graph([])
  capture.commands({
    note_list: { description: 'List notes', input: {}, query: '.note' },
  }, [tool])
  let before = capture.read().tools.find((t) => t.name == 'note_list')!
  capture.commands({}, [])
  let snapshot = capture.read()
  let after = snapshot.tools.find((t) => t.name == 'note_list')!
  assertEquals(after.id, before.id)
  assertEquals([after.loaded, after.bound], [false, false])
  assertEquals(snapshot.commands, [])
})

test('worker anatomy keeps package tools lazy despite runner wrappers', () => {
  let capture = workerAnatomy({ plugins: ['fixture'] })
  capture.composition.declarations(words.docs, words)
  capture.composition.effects(new Map([['note_seen', 'fixture']]), true)
  capture.graph([])
  capture.commands({}, [tool])
  let before = capture.read()
  assertEquals(before.tools.find((t) => t.name == 'note_list')?.loaded, false)
  assertEquals(
    before.effects.find((e) => e.name == 'note_seen')?.handler,
    'fixture',
  )
  capture.composition.loaded('fixture', 'tools', true)
  capture.composition.runs('fixture', ['note_list'], ['note_list'])
  let after = capture.read()
  assertEquals(after.tools.find((t) => t.name == 'note_list')?.bound, true)
  assertEquals(
    after.facets.find((f) => f.package == 'fixture' && f.name == 'tools')
      ?.bound,
    true,
  )
  assertEquals(before.tools.find((t) => t.name == 'note_list')?.loaded, false)
})
