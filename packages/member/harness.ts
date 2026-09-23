// Shared test fixtures (not part of the published package — see deno.json): a
// book club, defined as a vocabulary.
//
// The club is a `space`. It has two apps: a reading `list` everyone may see and
// a `notes` page only the committee reads. People are `person` entities. The
// storage is @yaks/ram, which is how a browser page or a test uses this
// package — a Map holding the rows, with the same `apply()` and the same query
// grammar as a database.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Bundle } from '@yaks/graph'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { memberDoc } from './comp.ts'
import { members } from './plugin.ts'
import type { Floors } from './guard.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // The club itself, and the people in it.
    space: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    // An app the club runs — the reading list, the notes page.
    app: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        name: { type: 'string' },
        space: { type: 'string', ref: 'space', death: 'cascade' },
      },
    },
    // Ordinary content, so a test can write something that is not membership.
    pick: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        by: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** The book club's vocabulary: the club, its people, its apps, and membership
 * loaded beside them. */
export let club: Vocab = loadVocab([memberDoc, doc])

/** The ids the tests share: the club, four people, and its two apps. */
export let ids = {
  club: 'club',
  dana: 'dana', // the owner
  raj: 'raj', // a member with an editor grant on the list
  mo: 'mo', // a member with a viewer grant on the list
  kim: 'kim', // a stranger — not on the roster, no grant
  list: 'list', // the reading list
  notes: 'notes', // the committee's notes
}

/** A storage holding the club, its people, its two apps, and a roster: Dana
 * owns the club, Raj and Mo are members, Kim is on nothing. */
export let store = (): Storage => {
  let s = ram(club)
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
    // The roster, written before any guard is installed — the bootstrap.
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

/** A guarded graph over that storage, deciding for one of the club's apps,
 * with any components that ask a level of their own. */
export let guarded = (s: Storage, app: string, floors?: Floors): Graph =>
  graph({
    storage: s,
    vocab: club,
    plugins: [members({ app, space: ids.club, floors })],
  })

/** An unguarded write into the storage — how the club was set up in the first
 * place, and how a test arranges the next case to try. */
export let seed = (s: Storage, ...bundles: Bundle[]) => {
  graph({ storage: s, vocab: club }).apply(bundles)
}

/** Set an app's access mode, the way an owner would. */
export let setMode = (s: Storage, app: string, mode: string) =>
  seed(s, { entity: { eid: app }, access: { mode } })

/** A grant on an app: for a person, or — with a `token` and no person — for
 * whoever opens the share link. */
export let grant = (
  s: Storage,
  eid: string,
  g: { app: string; person?: string; token?: string; access: string },
) => seed(s, { entity: { eid }, grant: g })
