import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { nativeAnatomy, secretNames } from './anatomy.ts'

let roles = {
  graph: ['vocab', 'rules', 'tools'],
  effects: ['effects'],
  web: ['routes'],
}
let docs: VocabDoc[] = [{
  package: 'shop',
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    book_list: { tool: true, input: {} },
    book_seen: { effect: true, created: ['book'] },
  },
}]

test('native anatomy isolates loading evidence even when vocabulary is shared', () => {
  let vocab = loadVocab(docs)
  let first = nativeAnatomy(['shop'], ['graph', 'effects'], roles)
  let second = nativeAnatomy(['shop'], ['graph'], roles)
  for (let capture of [first, second]) {
    capture.attempted('shop', 'vocab')
    capture.loaded('shop', 'vocab', true)
    capture.declarations(docs, vocab)
    capture.graphed()
  }
  let prior = first.read()
  assertEquals(prior.tools[0].declared, true)
  assertEquals(prior.tools[0].loaded, false)
  assertEquals(prior.tools[0].bound, false)
  let facet = prior.facets.find((f) =>
    f.package == 'shop' && f.name == 'tools'
  )!
  assertEquals([facet.selected, facet.attempted, facet.loaded], [
    true,
    false,
    false,
  ])
  first.attempted('shop', 'tools')
  first.loaded('shop', 'tools', true)
  first.runs('shop', ['book_list'], ['book_list'])
  first.effects(new Map(), true)
  let after = first.read()
  assertEquals(after.tools[0].id, prior.tools[0].id)
  assertEquals([after.tools[0].loaded, after.tools[0].bound], [true, true])
  assertEquals([after.effects[0].bound, after.effects[0].noop], [true, true])
  assertEquals([second.read().tools[0].loaded, second.read().tools[0].bound], [
    false,
    false,
  ])
  assertEquals(second.read().effects[0].noop, false)
  assertEquals(after.scope, 'native')
  assertEquals(after.skills, [])
  assertEquals(after.observed?.skills, false)
})

test('native secret observation reads only raw names, not resolved accessors', () => {
  let reads = 0
  let options = {
    token: { secret: 'service-token' },
    nested: [{ secret: 'another-token' }],
    password: 'never included',
    mixed: { secret: 'not-a-declaration', other: true },
  }
  Object.defineProperty(options, 'resolved', {
    enumerable: true,
    get: () => {
      reads++
      return 'vault value'
    },
  })
  let names = secretNames(options)
  assertEquals(names, ['service-token', 'another-token'])
  assertEquals(reads, 0)
  let capture = nativeAnatomy(
    ['shop'],
    [],
    roles,
    names.map((name) => ({ name, package: 'shop' })),
  )
  assertEquals(capture.read().secrets.map((s) => s.name), names)
  assertEquals(capture.read().observed?.secrets, true)
})
