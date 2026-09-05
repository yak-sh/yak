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

import type { VocabDoc } from '@yaks/vocab'

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
export let memberDoc: VocabDoc = {
  title: 'member',
  $defs: {
    member: {
      type: 'object',
      kind: true,
      description: 'a person’s seat on a space’s roster',
      properties: {
        space: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          description: 'the space they belong to',
        },
        person: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          bare: false,
          description: 'the person who belongs',
        },
        role: {
          enum: ['owner', 'member'],
          default: 'member',
          description:
            'owner runs the space and owns everything in it; member belongs, and reaches what they are granted',
        },
      },
    },
    grant: {
      type: 'object',
      kind: true,
      description: 'what one person may do with one app',
      properties: {
        app: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          description: 'the app the grant is on',
        },
        person: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          bare: false,
          description:
            'the person it is for — absent on a share link, which names a token instead',
        },
        token: {
          type: 'string',
          description:
            'an unguessable secret standing in for a person: whoever opens it acts AS this grant',
        },
        access: {
          enum: ['owner', 'editor', 'viewer'],
          default: 'viewer',
          bare: false,
          description: 'owner shares and deletes, editor writes, viewer reads',
        },
      },
    },
    access: {
      type: 'object',
      description: 'what an app says about everyone with no grant on it',
      properties: {
        mode: {
          enum: ['public', 'open', 'private'],
          default: 'public',
          description:
            'public: anyone reads. open: anyone reads and writes. private: only the granted see it.',
        },
      },
    },
  },
}
