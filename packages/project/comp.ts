// The components this package ships, as one vocabulary document to load beside
// your own.
//
//   project{}                                   what work is filed under
//   filed{project, priority, domain, assignee}  the filing itself
//   board{query}                                a saved filter over it
//   venture{phase, tagline, site}               a business being built
//   paused{at}                                  work on it is suspended
//   repo{repository, base_branch, gate, push}   where it lands its source
//
// Filing is separate from being A task. A task with no `filed` component at all
// is still a task, and the filing is the optional component that puts one in a
// portfolio. `filed.project` is declared `death: detach`: deleting a project
// frees its tasks rather than deleting them, because they are not about the
// project, they were only filed under it.
//
// A board is its query. `board{query}` holds a filter, and membership is never
// stored — there is no row saying this task is on that board. So a board is
// always current: a task that starts matching is on it, with nothing to
// reconcile. The empty query selects nothing, which is what a board nobody has
// written a filter for should show, and ./guard.ts refuses the rest.
//
// A venture has A phase, not A status. It is never done: it is incubating, or
// building, or live, or shuttered. Suspending work on it is the separate
// `paused` component, so the phase underneath is untouched and resuming means
// removing that component — there is no column remembering which phase to put
// back.
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
 * @yaks/task}'s: `loadVocab([taskDoc, projectDoc, ...mine])`. It declares
 * nothing about what a task is — only what one is filed under and looked at
 * through.
 */
export let projectDoc: VocabDoc = doc as VocabDoc
