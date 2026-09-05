// The three components this package ships, as one vocabulary document to load
// beside your own.
//
//   member{space, person, role}    the roster: who belongs to a space
//   grant{app, person, token, access}  the access: what one person may do
//                                      with one app
//   access{mode}                   the app's word about everyone else
//
// Two layers, because they answer different questions. A roster is who you
// would evict — one row, and they are gone from everything. A grant is what
// they may touch while they are here. Keeping them apart means a club can add
// a member without deciding, in the same breath, what that member may edit.
//
// Every reference dies with what it points at (`death: cascade`). A roster row
// about a deleted person is not a fact about anybody; a grant on a deleted app
// grants nothing. There is no orphan sweep to run because there are no orphans.
//
// `person` and `access` yield their bare words (`bare: false`): two components
// name a person, and `access` is both a component here and a column on `grant`,
// so both are said in full — `.grant.person=<id>`, `.grant.access=editor`.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// say and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming a seat on a space's roster. */
export let MEMBER = 'member'

/** The component naming one person's access to one app. */
export let GRANT = 'grant'

/** The component carrying an app's access mode. */
export let ACCESS = 'access'

/** The components this package governs: only an owner may write one. */
export let GOVERNED: string[] = [MEMBER, GRANT, ACCESS]

/**
 * The membership vocabulary, to load beside your own:
 * `loadVocab([memberDoc, ...mine])`. It declares nothing about what a space or
 * an app IS — both are plain entities in your own vocabulary — only who
 * belongs to one and who may reach the other.
 */
export let memberDoc: VocabDoc = doc
