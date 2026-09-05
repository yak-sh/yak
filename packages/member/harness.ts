// Shared test fixtures (not part of the published package — see deno.json): a
// book club, written as a vocabulary.
//
// The club is a `space`. It runs two things: a reading `list` everyone may see
// and a `notes` page only the committee reads. People are `person` entities.
// The store is @yaks/memory, which is how a page or a test composes this
// package — a Map holding the bundles, the same `apply()` and the same query
// grammar as a database.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Bundle } from '@yaks/graph'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { memory } from '@yaks/memory'
import { memberDoc } from './comp.ts'
import { members } from './plugin.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // The club itself, and the people in it.
    space: { type: 'object', kind: true, properties: { name: {} } },
    person: { type: 'object', kind: true, properties: { name: {} } },
    // A thing the club runs — the reading list, the notes page.
    app: {
      type: 'object',
      kind: true,
      properties: {
        name: {},
        space: { type: 'string', ref: 'space', death: 'cascade' },
      },
    },
    // Ordinary content, so a test can write something that is not membership.
    pick: {
      type: 'object',
      kind: true,
      properties: {
        title: {},
        by: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** The book club's vocabulary: the club, its people, its things, and
 * membership loaded beside them. */
export let club: Vocab = loadVocab([memberDoc, doc])

/** The ids the tests share: the club, three people, two things it runs. */
export let ids = {
  club: 'club',
  dana: 'dana', // the owner
  raj: 'raj', // a member with an editor grant on the list
  mo: 'mo', // a member with a viewer grant on the list
  kim: 'kim', // a stranger — no seat, no grant
  list: 'list', // the reading list
  notes: 'notes', // the committee's notes
}

/** A store holding the club, its people, its two things, and a roster: Dana
 * owns the club, Raj and Mo have seats, Kim has nothing. */
export let store = (): Storage => {
  let s = memory(club)
  let g = graph({ storage: s, vocab: club })
  let { club: c, dana, raj, mo, kim, list, notes } = ids
  g.apply([
    { entity: { eid: c }, space: { name: 'Tuesday Books' } },
    { entity: { eid: dana }, person: { name: 'Dana' } },
    { entity: { eid: raj }, person: { name: 'Raj' } },
    { entity: { eid: mo }, person: { name: 'Mo' } },
    { entity: { eid: kim }, person: { name: 'Kim' } },
    { entity: { eid: list }, app: { name: 'Reading list', space: c } },
    { entity: { eid: notes }, app: { name: 'Notes', space: c } },
    // The roster, seeded before any guard exists — the bootstrap.
    {
      entity: { eid: 'seat1' },
      member: { space: c, person: dana, role: 'owner' },
    },
    { entity: { eid: 'seat2' }, member: { space: c, person: raj } },
    { entity: { eid: 'seat3' }, member: { space: c, person: mo } },
    // Raj edits the list, Mo only reads it. Neither is granted the notes.
    {
      entity: { eid: 'g1' },
      grant: { app: list, person: raj, access: 'editor' },
    },
    {
      entity: { eid: 'g2' },
      grant: { app: list, person: mo, access: 'viewer' },
    },
  ])
  return s
}

/** A guarded graph over that store, speaking for one of the club's things. */
export let guarded = (s: Storage, app: string): Graph =>
  graph({
    storage: s,
    vocab: club,
    plugins: [members({ app, space: ids.club })],
  })

/** An unguarded write into the store — how the club was set up in the first
 * place, and how a test arranges the next thing to try. */
export let seed = (s: Storage, ...bundles: Bundle[]) => {
  graph({ storage: s, vocab: club }).apply(bundles)
}

/** The mode a thing is in, set the way an owner would set it. */
export let setMode = (s: Storage, app: string, mode: string) =>
  seed(s, { entity: { eid: app }, access: { mode } })

/** A grant on a thing: for a person, or — with a `token` and no person — for
 * whoever opens the share link. */
export let grant = (
  s: Storage,
  eid: string,
  g: { app: string; person?: string; token?: string; access: string },
) => seed(s, { entity: { eid }, grant: g })
