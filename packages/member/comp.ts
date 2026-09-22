// The three components this package defines, as one vocabulary document to
// load beside your own.
//
//   member{space, person, role}        the roster: who belongs to a space
//   grant{app, person, token, access}  the permission: what one principal may
//                                      do with one app
//   access{mode}                       what the app allows everyone else
//
// Two layers, because they answer different questions. The roster is who you
// would remove — delete one row and they are gone from everything. A grant is
// what they may touch while they are here. Keeping them apart means a club can
// add a member without deciding, in the same breath, what that member may edit.
//
// Every reference is deleted with what it points at (`death: cascade`). A
// roster row about a deleted person is not a fact about anybody; a grant on a
// deleted app grants nothing. There is no orphan sweep to run because there are
// no orphans.
//
// `person` and `access` opt out of the short form (`bare: false`): two
// components have a `person` column, and `access` is both a component here and
// a column on `grant`, so a query names both in full — `.grant.person=<id>`,
// `.grant.access=editor`.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import, and keeps the prose about why it is shaped this way.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The name of the component recording one person's place on a space's
 * roster. */
export let MEMBER = 'member'

/** The name of the component recording one principal's permission on one
 * app. */
export let GRANT = 'grant'

/** The name of the component carrying an app's access mode. */
export let ACCESS = 'access'

/** The components this package governs: only an owner may write one. */
export let GOVERNED: string[] = [MEMBER, GRANT, ACCESS]

/**
 * The membership vocabulary, to load beside your own:
 * `loadVocab([memberDoc, ...mine])`. It declares nothing about what a space or
 * an app is — both are plain entities in your own vocabulary — only who belongs
 * to one and who may reach the other.
 */
export let memberDoc: VocabDoc = doc
