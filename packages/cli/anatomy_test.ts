import { assert, assertEquals } from '@std/assert'
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


test('native anatomy keeps actual UI and later command/view loading separate', () => {
  let first = nativeAnatomy(['shop'], ['web'], roles)
  let second = nativeAnatomy(['shop'], ['web'], roles)
  let ran = 0
  let ui = {
    kits: { base: { Piece: { Component: () => { ran++ }, sheet: () => { ran++ } } } },
    themes: { forest: { css: new URL('https://example.invalid/theme.css') } },
  }
  Object.defineProperty(ui.kits, 'vault', {
    enumerable: true, get: () => { ran++; return 'not a kit' },
  })
  first.observe({ package: 'shop', facet: 'ui', loaded: true, bound: true, value: ui })
  let before = first.read()
  assertEquals(before.kits.map((k) => k.name), ['base'])
  assertEquals(before.themes.map((k) => k.name), ['forest'])
  assertEquals(before.observed?.views, false)
  assertEquals(before.observed?.commands, false)
  first.observe({ package: 'shop', facet: 'cli', loaded: true, bound: true, value: {
    commands: [{ name: 'peek', description: 'Look', inputSchema: { type: 'object', properties: {} }, run: () => { ran++ } }],
  } })
  let view = { view: 'Tile', match: true, render: () => { ran++ } }
  let inspect = { view: 'Inspect.Page', match: true, Render: () => { ran++ } }
  first.observe({ package: 'shop', facet: 'views', loaded: true, bound: true, value: {
    views: { renderers: [view] }, inspectViews: [inspect],
  } })
  first.observe({ package: 'shop', facet: 'tui', loaded: true, bound: true, value: { views: { renderers: [view] } } })
  let after = first.read()
  assertEquals(after.commands.map((c) => c.name), ['peek'])
  assertEquals(after.commands[0].schema, { type: 'object', properties: {} })
  assertEquals(after.views.map((v) => v.name), ['Tile'])
  assertEquals(after.inspectViews.map((v) => v.name), ['Inspect.Page'])
  assertEquals(after.tui.map((v) => v.name), ['Tile'])
  assertEquals(second.read().kits, [])
  assertEquals(second.read().observed?.commands, false)
  assertEquals(after.observed?.skills, false)
  assertEquals(ran, 0)
  assert(!JSON.stringify(after).includes('Component'))
  assert(!JSON.stringify(after).includes('render'))
})
