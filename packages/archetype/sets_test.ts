import { test } from '@yaks/testing'
import { derivedEid, sha256 } from '@yaks/graph'
import {
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
  assertThrows,
} from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import {
  Archetypes,
  canonical,
  eidOf,
  namingOf,
  satisfies,
  tablesOf,
} from './mod.ts'

test('archetype identity is namespaced, bytewise, duplicate/order independent', () => {
  let names = ['\u{10000}', 'z', 'a', '\ue000', 'a']
  assertEquals(canonical(names), ['a', 'z', '\ue000', '\u{10000}'])
  let id = derivedEid('archetype|a,z,\ue000,\u{10000}')
  assertEquals(eidOf(names), id)
  assertEquals(eidOf(names.reverse()), id)
  assertEquals(tablesOf('["z","a"]'), ['a', 'z'])
  assertThrows(() => eidOf(['a|b']))
  assertThrows(() => eidOf(['a,b']))
  assertThrows(() => tablesOf('[1]'))
  for (let tables of [[], ['doc'], ['doc', 'task']]) {
    let eid = eidOf(tables)
    assertEquals(eid, new Archetypes().intern(tables).eid)
    // UUID vs full hex is a disjoint address space, not merely a different hash
    // preimage: even a blob containing our exact sentence cannot collide.
    assertEquals(eid.length, 36)
    for (let text of ['', tables.join('|'), 'archetype|' + tables.join(',')]) {
      assertNotEquals(eid, sha256(text))
      assertEquals(sha256(text).length, 64)
    }
  }
})

test('archetype transitions and presence answers are cached and invalidate on new sets', () => {
  let cache = new Archetypes()
  let a = cache.intern(['doc'])
  let b = cache.move(a, 'task', true)
  assertStrictEquals(cache.move(a, 'task', true), b)
  assertStrictEquals(cache.move(b, 'task', false), a)
  assertStrictEquals(cache.move(a, 'task', false), a)
  assertEquals(satisfies({ all: ['doc'], none: ['task'] }, a), true)
  assertEquals(satisfies({ all: ['doc'], none: ['task'] }, b), false)
  let p = { all: ['task'] }
  let first = cache.matching(p)
  assertStrictEquals(cache.matching(p), first)
  let c = cache.intern(['task'])
  assertEquals(cache.matching(p), [b.eid, c.eid])
  assertEquals(new Archetypes().intern(['task', 'doc']).eid, b.eid)
})

test('archetype decoding caches scalar content and reads mutable inputs anew', () => {
  let cache = new Archetypes()
  let note = cache.decode('["note"]')
  assertStrictEquals(cache.decode('["note"]'), note)
  assertEquals(cache.decode('["other"]').tables, ['other'])
  let names = ['note']
  assertStrictEquals(cache.decode(names), note)
  names[0] = 'other'
  assertEquals(cache.decode(names).tables, ['other'])
  for (let value of ['[1]', '["a|b"]', '{', null]) {
    assertThrows(() => cache.decode(value))
  }
  assertStrictEquals(cache.decode('["note"]'), note)
})

// A vocabulary whose `note` has an identity and whose `tag` has none yet.
let noteId = crypto.randomUUID()
let named = new Archetypes(namingOf(loadVocab({
  $defs: {
    note: { component: true, $id: `urn:uuid:${noteId}` },
    tag: { component: true },
  },
})))

test('a descriptor holds component identities, and a word without one its label', () => {
  let set = named.intern(['tag', 'note'])
  assertEquals(set.tables, ['note', 'tag'])
  assertEquals(set.descriptor, canonical([noteId, 'tag']))
  assertEquals(set.eid, eidOf([noteId, 'tag']))
  assertStrictEquals(named.decode(JSON.stringify(set.descriptor)), set)
  assertEquals(new Archetypes().intern(['tag']).eid, named.intern(['tag']).eid)
})

test('a descriptor of labels keeps its own eid, matches, and moves to identities', () => {
  let labels = named.decode('["note","tag"]')
  let set = named.intern(['note', 'tag'])
  assertEquals(labels.eid, eidOf(['note', 'tag']))
  assertNotEquals(labels.eid, set.eid)
  assertEquals(labels.tables, set.tables)
  assertStrictEquals(named.get(labels.eid), labels)
  assertEquals(
    named.matching({ all: ['note'] }).toSorted(),
    [
      labels.eid,
      set.eid,
    ].toSorted(),
  )
  assertStrictEquals(named.move(labels, 'tag', true), labels)
  assertStrictEquals(
    named.move(labels, 'tag', false),
    named.intern(['note']),
  )
})

test('tablesOf names a descriptor as a vocabulary holds its components', () => {
  let v = loadVocab({
    $defs: { note: { component: true, $id: `urn:uuid:${noteId}` } },
  })
  assertEquals(tablesOf(JSON.stringify([noteId, 'tag']), v), ['note', 'tag'])
  assertEquals(tablesOf(JSON.stringify([noteId])), [noteId])
})
