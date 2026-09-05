// Parity: the fleet's canvas comps, loaded through @yaks/canvas's own
// vocabulary document instead of the fleet manifest, answer the same as
// today. Swap `canvasDoc` in for the converted `canvas.json` inside the FULL
// fleet vocabulary and nothing downstream moves — same tables, same columns,
// same death worklists, same routing, same id prefixes.
//
// One deliberate divergence, asserted below rather than hidden: the fleet
// manifest says `layout` sorts `before` `doc`, and the package does not.
// `before` names ANOTHER kind and `kindOrder` refuses one no loaded document
// declares, so a package that ordered itself against a kind it does not ship
// could not load on its own. `doc` is the fleet's component, so the ordering
// is the fleet's to state — and here it costs nothing, because the fleet's
// other kinds already settle layout ahead of doc: kindOrder comes out
// identical either way.

import { assert, assertEquals } from '@std/assert'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { prefixes } from '@yaks/id'
import { syncKeywords, tierOf } from '@yaks/sync'
import { schema } from '@yaks/sqlite'
import { canvasDoc } from '@yaks/canvas'
import { fleetDocs, fleetKeywords } from './fleet_vocab.ts'

let keywords = [...fleetKeywords, syncKeywords]
let load = (docs: VocabDoc[]): Vocab => loadVocab(docs, keywords)

// The whole fleet, as it is; and the whole fleet with this one document
// swapped in for the manifest's canvas.
let today = load(fleetDocs())
let swapped = load(
  fleetDocs().map((d) => (d.title == 'canvas' ? canvasDoc : d)),
)

// The comps the package ships — the ones the swap is allowed to touch.
let ours = Object.keys(canvasDoc.$defs ?? {}).sort()

Deno.test('parity: the package ships exactly the manifest’s canvas comps', () => {
  let mine = fleetDocs().find((d) => d.title == 'canvas')!
  assertEquals(ours, Object.keys(mine.$defs ?? {}).sort())
})

Deno.test('parity: the same components, writable and stamped', () => {
  assertEquals(swapped.comps, today.comps)
  assertEquals(swapped.all, today.all)
  for (let name of ours) {
    let a = swapped.comp(name)!
    let b = today.comp(name)!
    assertEquals([a.name, a.wire, a.kind], [b.name, b.wire, b.kind], name)
    assertEquals(a.writable, b.writable, name)
    assertEquals(a.stamped, b.stamped, name)
  }
})

Deno.test('parity: every column, to the last keyword', () => {
  for (let name of ours) {
    assertEquals(swapped.columns(name), today.columns(name), name)
    for (let prop of today.columns(name)) {
      assertEquals(
        swapped.column(name, prop),
        today.column(name, prop),
        `${name}.${prop}`,
      )
    }
  }
})

Deno.test('parity: the death worklists, all four words', () => {
  for (let word of ['cascade', 'detach', 'release', 'keep'] as const) {
    assertEquals(swapped.deaths(word), today.deaths(word), word)
  }
})

Deno.test('parity: a card still dies with what it shows', () => {
  assertEquals(swapped.column('card', 'target')!.death, 'cascade')
})

Deno.test('parity: routing — every bare prop lands where it lands today', () => {
  let asked = (v: Vocab, prop: string) => {
    try {
      return v.route(prop)
    } catch {
      return 'unrouted'
    }
  }
  // every column name the fleet knows, not just ours: a swapped document
  // must not steal a bare word from another domain, or yield one it owns
  for (let name of today.all) {
    for (let prop of today.columns(name)) {
      assertEquals(asked(swapped, prop), asked(today, prop), `.${prop}`)
    }
  }
})

Deno.test('parity: the id prefixes', () => {
  assertEquals(prefixes(swapped), prefixes(today))
})

Deno.test('parity: the SQLite schema, statement for statement', () => {
  assertEquals(schema(swapped), schema(today))
})

Deno.test('every canvas comp syncs — the per-window ones included', () => {
  for (let name of ours) assertEquals(tierOf(swapped, name), 'wire', name)
})

Deno.test('divergence: layout drops `before`, and kindOrder does not move', () => {
  assertEquals(today.comp('layout')!.before, ['doc'])
  assertEquals(swapped.comp('layout')!.before, [])
  // The declaration is the whole of the difference. `before` feeds one thing,
  // kindOrder, and the fleet's own kinds already settle layout ahead of doc
  // without this constraint — so nothing an entity displays as changes.
  assertEquals(swapped.kinds, today.kinds)
  assert(swapped.kinds.indexOf('layout') < swapped.kinds.indexOf('doc'))
})
