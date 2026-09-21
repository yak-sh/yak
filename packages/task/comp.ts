// The components this package ships, as one vocabulary document to load beside
// your own.
//
//   task{}                            a to-do item, with a computed status
//   completed{at, by}                 it got done, when, and by whom
//   cancelled{at, by, reason}         it got called off, and why
//   blocked{on}                       something outside is in the way
//   requires / contains               the two relations between tasks
//
// What a task is filed UNDER — `project`, `filed`, the `board` that is a saved
// filter over the filing — belongs to @yaks/project: a task with nothing filed
// is still a task, and a portfolio is a different idea from a to-do item.
//
// Four things are worth explaining about the shapes, because each is a decision
// somebody would otherwise make differently.
//
// STATUS IS NOT STORED. `task.status` is declared `computed: true`: it is
// readable and filterable, and no writer sets it. Its value is computed from
// the `completed` and `cancelled` components (./status.ts), which is why
// finishing a task means writing a fact with a time and an author rather than
// overwriting a value. Both evaluators get that rule from one list, so
// `.status=done` selects the same tasks in a database and in a page. The `enum`
// in the document holds the DEFAULT ladder's values; an application that adds a
// rung widens them where it declares its own document.
//
// THE TWO RELATIONS are `requires` and `contains`, as @yaks/edge reads them: a
// component that an edge entity carries beside `edge{from, to}`. Neither has
// any columns — the link itself is the whole of what they mean.
//
// BLOCKED IS A COMPONENT, NOT A STATUS. `blocked{on}` records that something
// OUTSIDE the graph is in the way — waiting on a vendor, on a decision, on a
// person. It is deliberately not a rung on the status ladder: a blocked task is
// still open work, and rolling it into the status would hide it from every
// open-work query exactly when somebody needs to see it. Unfinished `requires`
// children are not blocking either; they are ordinary work, counted and shown,
// never an alarm.
//
// THE MARKS OUTLIVE THE PEOPLE. `completed.by` and `cancelled.by` are
// `death: keep` — deleting the person who finished a task does not unfinish it.
// The reference stands as history.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import, and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component that makes an entity a task. */
export let TASK = 'task'

/** The mark on a finished task. */
export let COMPLETED = 'completed'

/** The mark on a task that was called off. */
export let CANCELLED = 'cancelled'

/** The component recording that something outside the graph is in the way. */
export let BLOCKED = 'blocked'

/** The relation from a task to work it waits for. */
export let REQUIRES = 'requires'

/** The relation from a task to work that is part of it. */
export let CONTAINS = 'contains'

/**
 * The task vocabulary, to load beside your own:
 * `loadVocab([taskDoc, ...mine], [edgeKeywords, ...])`. It declares nothing
 * about what a person or a document IS — bring your own `doc` (or
 * {@link https://jsr.io/@yaks/doc | @yaks/doc}'s), and whatever else your tasks
 * carry.
 *
 * `requires` and `contains` are declared through
 * {@link https://jsr.io/@yaks/edge | @yaks/edge}'s `relation` keyword, so an
 * edge entity carrying one of them states that link. Register `edgeKeywords`
 * when you load, or the loader will carry the declaration with nobody reading
 * it.
 */
export let taskDoc: VocabDoc = doc
