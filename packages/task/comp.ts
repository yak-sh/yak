// The components this package ships, as one vocabulary document to load beside
// your own.
//
//   task{status, priority, project}   what makes an entity a to-do item
//   project{}                         something the tasks are grouped under
//   board{query}                      a saved filter over them
//   completed{at, by}                 it got done, when, and by whom
//   cancelled{at, by, reason}         it got called off, and why
//   blocked{on}                       something outside is in the way
//   requires / contains               the two relations tasks state
//
// Four things are worth saying about the shapes, because each is a decision
// somebody would otherwise make differently.
//
// STATUS IS NOT STORED. `task.status` is declared `persist: false`: it is
// readable and filterable, and no writer sets it. Its value is read off the
// `completed` and `cancelled` marks (./status.ts), which is why finishing a task
// is writing a fact with a time and an author rather than overwriting a word.
// Both evaluators get that rule from one list, so `.status=done` selects the
// same tasks in a database and in a page.
//
// A BOARD IS ITS QUERY. `board{query}` holds a filter, and membership is never
// stored — there is no row saying this task is on that board. So a board is
// always current: a task that starts matching is on it, with nothing to
// reconcile. The empty query selects nothing, which is what a board nobody has
// written a filter for should show.
//
// BLOCKED IS A FACET, NOT A STATUS. `blocked{on}` says something OUTSIDE the
// graph is in the way — waiting on a vendor, on a decision, on a person. It is
// deliberately not a rung on the status ladder: a blocked task is still open
// work, and rolling it into the status would hide it from every open-work query
// exactly when somebody needs to see it. Unfinished `requires` children are not
// blocking either; they are ordinary work, counted and shown, never an alarm.
//
// THE MARKS DIE WITH NOBODY. `completed.by` and `cancelled.by` are `death: keep`
// — deleting the person who finished a task does not unfinish it. The reference
// stands as history. `task.project` is `death: detach`: deleting a project frees
// its tasks rather than deleting them, because they are not ABOUT the project,
// they were only filed under it.

import type { VocabDoc } from '@yaks/vocab'
import { CORE_URI } from '@yaks/vocab'
import { EDGE_URI } from '@yaks/edge'
import { OPEN } from './words.ts'

/** The component that makes an entity a task. */
export let TASK = 'task'

/** The component naming something tasks are grouped under. */
export let PROJECT = 'project'

/** The component carrying a board's saved query. */
export let BOARD = 'board'

/** The mark a finished task wears. */
export let COMPLETED = 'completed'

/** The mark a called-off task wears. */
export let CANCELLED = 'cancelled'

/** The facet saying something outside the graph is in the way. */
export let BLOCKED = 'blocked'

/** The relation a task states about work it waits for. */
export let REQUIRES = 'requires'

/** The relation a task states about work that is part of it. */
export let CONTAINS = 'contains'

/**
 * The task vocabulary, to load beside your own:
 * `loadVocab([taskDoc, ...mine], [edgeKeywords, ...])`. It declares nothing
 * about what a person or a document IS — bring your own `doc` (or
 * {@link https://jsr.io/@yaks/doc | @yaks/doc}'s), and whatever else your tasks
 * wear.
 *
 * `requires` and `contains` are declared through
 * {@link https://jsr.io/@yaks/edge | @yaks/edge}'s `relation` keyword, so an
 * edge entity wearing one states that link. Register `edgeKeywords` when you
 * load, or the loader carries the declaration without anybody reading it.
 */
export let taskDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true, [EDGE_URI]: true },
  title: 'task',
  $defs: {
    task: {
      type: 'object',
      kind: true,
      description: 'a thing to do',
      properties: {
        status: {
          // Computed, never stored: read off the marks (./status.ts). The
          // members are the default ladder's; an application that adds a rung
          // widens them where it declares its own document.
          type: 'string',
          enum: ['cancelled', 'done', OPEN],
          persist: false,
          description:
            'where the task stands — read off the completed and cancelled marks, never written',
        },
        priority: {
          type: 'number',
          format: 'priority',
          description: 'queue order — lower is more urgent',
        },
        project: {
          type: 'string',
          ref: 'project',
          death: 'detach',
          description:
            'what it is filed under; deleting the project frees the task rather than taking it along',
        },
      },
    },
    project: {
      type: 'object',
      kind: true,
      description: 'something tasks are grouped under',
      properties: {},
    },
    board: {
      type: 'object',
      kind: true,
      description: 'a saved filter over the tasks — membership is never stored',
      properties: {
        query: {
          type: 'string',
          format: 'query',
          description:
            'the filter that IS the board; the empty query selects nothing',
        },
      },
    },
    completed: {
      type: 'object',
      description: 'the mark a finished task wears',
      properties: {
        at: { type: 'string', format: 'date-time', description: 'when' },
        by: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'who finished it — kept as history when that entity is deleted',
        },
      },
    },
    cancelled: {
      type: 'object',
      description: 'the mark a called-off task wears',
      properties: {
        at: { type: 'string', format: 'date-time', description: 'when' },
        by: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'who called it off — kept as history when that entity is deleted',
        },
        reason: { type: 'string', description: 'why it was called off' },
      },
    },
    blocked: {
      type: 'object',
      description:
        'something outside the graph is in the way. A facet, never a status: a blocked task is still open work.',
      properties: {
        on: {
          type: 'string',
          description: 'what it is waiting on, said in words',
        },
      },
    },
    // The two relations, as @yaks/edge reads them: a component an edge entity
    // wears beside `edge{from, to}`. Neither carries columns — the sentence is
    // the whole of what they say.
    requires: {
      type: 'object',
      relation: true,
      description: 'this task waits for that one',
      properties: {},
    },
    contains: {
      type: 'object',
      relation: true,
      description: 'that task is part of this one',
      properties: {},
    },
  },
}
