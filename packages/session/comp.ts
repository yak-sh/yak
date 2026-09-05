// The five components this package ships, as one vocabulary document to load
// beside your own.
//
//   session{id, actor, parent, provider, model, effort, turn, …}
//                            one run of a worker over the graph
//   claim{session}           that run's lock on the entity it rides
//   stop_request{target}     ask a run to wind down
//   brief{text}              what the run says it did
//   conflict{target, loser, holder, at}
//                            the record of two runs wanting one thing
//
// The shape worth noticing is the CLAIM. A lock is not a row about a document
// somewhere else — it is a component ON the document, so "who holds this?" is
// answered by the entity itself, one lock per entity by construction, and a
// query for locked documents is a query for entities wearing `claim`.
//
// `claim.session` dies by `release`: when a run's entity is deleted its lock
// ROW goes and the document it was on lives. That is the whole "a dying run
// lets go" rule — declared in the vocabulary, executed by @yaks/graph's
// cascade, with no code in this package at all.
//
// `conflict` is entirely stamped: every column is server-owned, because the
// audit is written by the graph after a refusal, never sent by a client. A
// forged conflict record would be worse than none.

import type { VocabDoc } from '@yaks/vocab'
import { ACTIVE, STATUSES } from './words.ts'

/** The component naming one run of a worker over the graph. */
export let SESSION = 'session'

/** The component naming a run's lock on the entity that carries it. */
export let CLAIM = 'claim'

/** The component asking a run to wind down. */
export let STOP = 'stop_request'

/** The component carrying what a run says it did. */
export let BRIEF = 'brief'

/** The component recording a refused take of somebody else's lock. */
export let CONFLICT = 'conflict'

/**
 * The session vocabulary, to load beside your own:
 * `loadVocab([sessionDoc, ...mine])`. It declares nothing about what the work
 * IS — a document, a task, a drawing are all plain entities in your own
 * vocabulary — only who is working, what they hold, and what happened when two
 * of them wanted the same thing.
 */
export let sessionDoc: VocabDoc = {
  title: 'session',
  $defs: {
    session: {
      type: 'object',
      kind: true,
      description: 'one run of a worker — a person’s editor, an agent’s turn',
      properties: {
        id: {
          type: 'string',
          description:
            'the runner’s own name for this run, stable across reconnects',
        },
        actor: {
          type: 'string',
          ref: 'entity',
          death: 'detach',
          description: 'who the run works as — the person or agent behind it',
        },
        parent: {
          type: 'string',
          ref: 'session',
          death: 'detach',
          bare: false,
          description: 'the run that started this one',
        },
        provider: {
          type: 'string',
          description: 'which service is running it',
        },
        model: { type: 'string', description: 'which model it is thinking in' },
        effort: {
          type: 'string',
          description: 'how hard it was asked to think',
        },
        turn: {
          enum: ['idle', 'busy'],
          description:
            'mid-thought, or waiting for the next instruction — an idle run is still alive',
        },
        status: {
          enum: STATUSES,
          stamped: true,
          description: `reported by the runner: ${
            ACTIVE.join(', ')
          } mean it is still there`,
        },
        started_at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when it began',
        },
        finished_at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when it ended — absent while it is still going',
        },
        exit_code: {
          type: 'number',
          stamped: true,
          description: 'how it ended: 0 for cleanly',
        },
      },
    },
    claim: {
      type: 'object',
      kind: true,
      description: 'a run’s lock on the entity carrying it',
      properties: {
        session: {
          type: 'string',
          ref: 'session',
          death: 'release',
          bare: false,
          description:
            'the run holding it — when that run’s entity dies the lock goes and the entity lives',
        },
        claimed_at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when it was taken — stamped when the lock is new',
        },
      },
    },
    stop_request: {
      type: 'object',
      kind: true,
      description: 'ask a run to wind down',
      properties: {
        target: {
          type: 'string',
          ref: 'session',
          death: 'cascade',
          description:
            'the run to stop — the request dies with the run it is about',
        },
      },
    },
    brief: {
      type: 'object',
      description: 'what a run says it did, in its own words',
      properties: {
        text: { type: 'string', description: 'the note it leaves behind' },
      },
    },
    conflict: {
      type: 'object',
      kind: true,
      description:
        'two runs wanted one thing: written after the refusal, never by a client',
      properties: {
        target: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          bare: false,
          stamped: true,
          description: 'the contested entity',
        },
        loser: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          bare: false,
          stamped: true,
          description: 'the run whose write was refused',
        },
        holder: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          bare: false,
          stamped: true,
          description: 'the run that already held the lock',
        },
        at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when they collided',
        },
      },
    },
  },
}
