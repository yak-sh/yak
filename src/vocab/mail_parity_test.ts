// Parity: @yaks/mail's vocabulary document — and the @yaks/doc it depends on —
// against the fleet's own manifests. The packages ship the comms domain as
// plugins; this asserts the fleet could load them in place of what it authors
// today and get the same tables and the same routing out.
//
// Five components are shipped in the fleet's own shape and are asserted COLUMN
// FOR COLUMN, including the DDL @yaks/sqlite emits for them:
//
//   doc{title,body}  email{address}  deliver{to}  delivered{at,via}
//   notified{at,by,via}
//
// `doc` is the one that moved. A letter's subject and body were columns on the
// package's `mail`; they are now @yaks/doc's `doc{title, body}`, the way the
// fleet has always modelled a letter (Jeff, 2026-09-05: "the mail package can't
// require the package that installs doc?"). So the fleet's whole `doc` — its
// table, its `doc_value` view, its FTS5 index and the three triggers that keep
// it current — is asserted identical against the package's document, which is
// the parity that matters: it is the table every readable thing in the graph
// shares.
//
// `mail` itself is asserted where the two OVERLAP (target, reply_to, from,
// message_id — same types, same death words, same `before: ['doc']`) and still
// diverges on the ENVELOPE: the package spells the address and the clock `to`
// and `at` (yielding their bare words through `bare: false`), where the fleet
// spells them `to_addr` and `received_at` and stamps them, and the fleet carries
// four more inbound columns of its own — `verified`, `sent_id`, `in_reply_to`,
// `headers` — that a mail package for anybody's graph does not ship. Those are
// the fleet's own workarounds and its own inbound plumbing, not a shape the
// package should grow; mapping one onto the other, when the fleet adopts this
// document, is a rename entry and a hook.
//
// The fleet's failure spelling is the shared `error{at,message}` facet
// (D-14945) across every deliverable kind; @yaks/mail spells its own half
// `bounced{at,reason}`, since a package for mail should not claim the word
// `error` in somebody else's graph.

import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import type { Column, PropSchema, Vocab } from '@yaks/vocab'
import { idKeywords } from '@yaks/id'
import { schema } from '@yaks/sqlite'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { fleetDocs, fleetKeywords, fleetVocab } from './fleet_vocab.ts'

let fleet = fleetVocab()
// The packages' documents, loaded with the same keyword vocabularies the fleet
// registers, so `prefix`, `store` and the rest are carried on both sides.
let pkg = loadVocab([docDoc, mailDoc], fleetKeywords)

// The comps the two packages ship in the fleet's own shape, and where each
// comes from — `doc` is @yaks/doc's, the rest are @yaks/mail's.
let SAME = ['doc', 'email', 'deliver', 'delivered', 'notified']
let shipped: Record<string, PropSchema> = {
  ...(docDoc.$defs ?? {}),
  ...(mailDoc.$defs ?? {}),
}

// Everything about a column that reaches storage or the wire, in one value.
let shape = (c: Column) => ({
  category: c.category,
  scalar: c.scalar,
  values: c.values,
  ref: c.ref,
  death: c.death,
  stamped: c.stamped,
  persist: c.persist,
  affinity: c.affinity,
  fk: c.fk,
})

let agree = (v: Vocab, w: Vocab, comp: string, prop: string) =>
  assertEquals(
    shape(w.column(comp, prop)!),
    shape(v.column(comp, prop)!),
    `${comp}.${prop}`,
  )

// The fleet's documents with the named comps taken out, and the packages' own
// put in their place — the swap the fleet would make to adopt them.
let swap = (names: string[]) =>
  loadVocab(
    [
      ...fleetDocs().map((d) => ({
        ...d,
        $defs: Object.fromEntries(
          Object.entries(d.$defs ?? {}).filter(([n]) => !names.includes(n)),
        ),
      })),
      {
        title: 'from the packages',
        $defs: Object.fromEntries(
          names.map((n) => [n, shipped[n]]),
        ),
      },
    ],
    fleetKeywords,
  )

Deno.test('parity: the shared comps, column for column', () => {
  for (let name of SAME) {
    let mine = pkg.comp(name)
    let theirs = fleet.comp(name)
    assert(mine, `the packages declare ${name}`)
    assertEquals(mine.writable, theirs!.writable, `${name} writable`)
    assertEquals(mine.stamped, theirs!.stamped, `${name} stamped`)
    assertEquals(mine.kind, theirs!.kind, `${name} kind`)
    assertEquals(mine.keywords, theirs!.keywords, `${name} keywords`)
    for (let p of fleet.columns(name)) agree(fleet, pkg, name, p)
  }
})

Deno.test('parity: the words a letter carries are a doc, not columns on mail', () => {
  // The move: `mail` no longer declares them, and both spellings route to the
  // same place the fleet routes them.
  for (let gone of ['subject', 'body']) {
    assertEquals(pkg.columns('mail').includes(gone), false, `mail.${gone}`)
  }
  for (let p of ['title', 'body']) {
    assertEquals(pkg.route(p), { comp: 'doc', prop: p }, `.${p}`)
    assertEquals(pkg.route(p), fleet.route(p), `.${p}`)
  }
})

Deno.test('parity: mail, where the two overlap', () => {
  for (let p of ['target', 'reply_to', 'from', 'message_id']) {
    assert(pkg.column('mail', p), `@yaks/mail declares mail.${p}`)
    assertEquals(
      { ...shape(pkg.column('mail', p)!), stamped: false },
      { ...shape(fleet.column('mail', p)!), stamped: false },
      `mail.${p}`,
    )
  }
  // The kind, its id prefix, and the order it sorts in are the fleet's: a
  // letter that wears both is a letter, not the `doc` it also wears.
  assertEquals(pkg.comp('mail')!.kind, true)
  assertEquals(pkg.comp('mail')!.keywords, fleet.comp('mail')!.keywords)
  assertEquals(pkg.comp('mail')!.before, fleet.comp('mail')!.before)
})

Deno.test('parity: the same DDL for the comps the packages ship whole', () => {
  let tables = (v: Vocab) =>
    schema(v).filter((s) => SAME.some((n) => s.includes(`"${n}"`))).sort()
  assertEquals(tables(swap(SAME)), tables(fleet))
})

Deno.test('parity: doc whole — the table, the view, the index and its triggers', () => {
  // Every statement @yaks/sqlite raises for `doc`, which is more than a table:
  // the `doc_value` view search reads through, the external-content FTS5 index,
  // and the three triggers that keep it current.
  let docish = (v: Vocab) => schema(v).filter((s) => s.includes('doc')).sort()
  let mine = docish(swap(['doc']))
  assert(mine.some((s) => s.includes('doc_fts')), 'the index is raised')
  assertEquals(mine, docish(fleet))
})

Deno.test('parity: the bare spellings the fleet already routes are untouched', () => {
  // Every bare word the fleet's mail domain answers today, asked of a fleet
  // vocabulary carrying the packages' `mail` and `doc` in place of its own.
  let swapped = swap(['mail', 'doc'])
  for (
    let p of ['address', 'to', 'from', 'target', 'reply_to', 'body', 'title']
  ) {
    assertEquals(swapped.route(p), fleet.route(p), `.${p}`)
  }
})

Deno.test('parity: the id prefixes a letter and an address read as', () => {
  let v = loadVocab([docDoc, mailDoc], [idKeywords])
  assertEquals(v.comp('mail')!.keywords.prefix, 'E')
  assertEquals(v.comp('email')!.keywords.prefix, 'A')
})
