// Parity: @yaks/mail's vocabulary document against the fleet's own mail
// manifests. The package ships the comms domain as a plugin; this asserts the
// fleet could load it in place of what it authors today and get the same
// tables and the same routing out.
//
// Four components are shipped in the fleet's own shape and are asserted COLUMN
// FOR COLUMN, including the DDL @yaks/sqlite emits for them:
//
//   email{address}  deliver{to}  delivered{at,via}  notified{at,by,via}
//
// `mail` itself is asserted where the two OVERLAP (target, reply_to, from,
// message_id — same types, same death words) and deliberately diverges
// elsewhere: the package's letter carries its own `to`, `subject`, `body` and
// `at`, where the fleet keeps the subject and body on `doc` and spells the
// envelope `to_addr`/`received_at`. A package a stranger installs cannot
// require a component it does not ship, so the letter is whole. Those four
// columns yield their bare spellings (`bare: false`) precisely so that adding
// them changes no routing the fleet already has — which is what the routing
// half of this test checks.
//
// The fleet's failure spelling is the shared `error{at,message}` facet
// (D-14945) across every deliverable kind; @yaks/mail spells its own half
// `bounced{at,reason}`, since a package for mail should not claim the word
// `error` in somebody else's graph. Mapping one to the other, when the fleet
// adopts this document, is one hook.

import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import type { Column, Vocab } from '@yaks/vocab'
import { idKeywords } from '@yaks/id'
import { schema } from '@yaks/sqlite'
import { mailDoc } from '@yaks/mail'
import { fleetDocs, fleetKeywords, fleetVocab } from './fleet_vocab.ts'

let fleet = fleetVocab()
// The package's document, loaded with the same keyword vocabularies the fleet
// registers, so `prefix` and the rest are carried on both sides.
let pkg = loadVocab([mailDoc], fleetKeywords)

// The comps @yaks/mail ships in the fleet's own shape.
let SAME = ['email', 'deliver', 'delivered', 'notified']

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

Deno.test('parity: the shared comps, column for column', () => {
  for (let name of SAME) {
    let mine = pkg.comp(name)
    let theirs = fleet.comp(name)
    assert(mine, `@yaks/mail declares ${name}`)
    assertEquals(mine.writable, theirs!.writable, `${name} writable`)
    assertEquals(mine.stamped, theirs!.stamped, `${name} stamped`)
    assertEquals(mine.kind, theirs!.kind, `${name} kind`)
    assertEquals(mine.keywords, theirs!.keywords, `${name} keywords`)
    for (let p of fleet.columns(name)) agree(fleet, pkg, name, p)
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
  // The letter is whole: it carries its own subject and body, which the fleet
  // keeps on `doc`. The kind and its id prefix are the fleet's.
  assertEquals(pkg.comp('mail')!.kind, true)
  assertEquals(pkg.comp('mail')!.keywords, fleet.comp('mail')!.keywords)
  assertEquals(pkg.columns('mail').includes('subject'), true)
})

Deno.test('parity: the same DDL for the comps it ships whole', () => {
  // The fleet's schema, and the fleet's schema with @yaks/mail's document
  // standing in for the manifests' spelling of those four comps.
  let swapped = loadVocab(
    [
      ...fleetDocs().map((d) => ({
        ...d,
        $defs: Object.fromEntries(
          Object.entries(d.$defs ?? {}).filter(([n]) => !SAME.includes(n)),
        ),
      })),
      {
        title: 'mail (from @yaks/mail)',
        $defs: Object.fromEntries(
          Object.entries(mailDoc.$defs ?? {}).filter(([n]) => SAME.includes(n)),
        ),
      },
    ],
    fleetKeywords,
  )
  let tables = (v: Vocab) =>
    schema(v).filter((s) => SAME.some((n) => s.includes(`"${n}"`))).sort()
  assertEquals(tables(swapped), tables(fleet))
})

Deno.test('parity: the bare spellings the fleet already routes are untouched', () => {
  // Every bare word the fleet's mail domain answers today, asked of a fleet
  // vocabulary carrying @yaks/mail's `mail` in place of the manifests'.
  let swapped = loadVocab(
    [
      ...fleetDocs().map((d) => ({
        ...d,
        $defs: Object.fromEntries(
          Object.entries(d.$defs ?? {}).filter(([n]) => n != 'mail'),
        ),
      })),
      {
        title: 'mail (from @yaks/mail)',
        $defs: { mail: mailDoc.$defs!.mail },
      },
    ],
    fleetKeywords,
  )
  for (
    let p of ['address', 'to', 'from', 'target', 'reply_to', 'body', 'title']
  ) {
    assertEquals(swapped.route(p), fleet.route(p), `.${p}`)
  }
})

Deno.test('parity: the id prefixes a letter and an address read as', () => {
  let v = loadVocab([mailDoc], [idKeywords])
  assertEquals(v.comp('mail')!.keywords.prefix, 'E')
  assertEquals(v.comp('email')!.keywords.prefix, 'A')
})
