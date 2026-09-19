// The components this package ships, as one vocabulary document to load beside
// your own.
//
//   project{}                                   what work is filed under
//   filed{project, priority, domain, assignee}  the filing itself
//   board{query}                                a saved filter over it
//   venture{phase, run_mode, …}                 a business being built
//
// FILING IS SEPARATE FROM BEING A TASK. A task is a task with no `filed` at
// all — a microtask carries none — and the filing is the optional word that
// puts one in a portfolio. `filed.project` is `death: detach`: deleting a
// project frees its tasks rather than deleting them, because they are not
// ABOUT the project, they were only filed under it.
//
// A BOARD IS ITS QUERY. `board{query}` holds a filter, and membership is never
// stored — there is no row saying this task is on that board. So a board is
// always current: a task that starts matching is on it, with nothing to
// reconcile. The empty query selects nothing, which is what a board nobody has
// written a filter for should show, and ./guard.ts refuses the rest.
//
// A VENTURE HAS A PHASE, NOT A STATUS. It is never done: it is incubating, or
// building, or live, or shuttered, and what it was `paused_from` or `hold_from`
// is kept so resuming needs no memory.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming something work is filed under. */
export let PROJECT = 'project'

/** The optional portfolio filing: project, priority, domain and assignee. */
export let FILED = 'filed'

/** The component carrying a board's saved query. */
export let BOARD = 'board'

/** The component naming a business being built. */
export let VENTURE = 'venture'

/**
 * The portfolio vocabulary, to load beside {@link https://jsr.io/@yaks/task |
 * @yaks/task}'s: `loadVocab([taskDoc, projectDoc, ...mine])`. It says nothing
 * about what a task IS — only what one is filed under and looked at through.
 */
export let projectDoc: VocabDoc = doc as VocabDoc
