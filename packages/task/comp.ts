// The components this package ships, as one vocabulary document to load beside
// your own.
//
//   task{}                            a to-do item, with a computed status
//   cancelled{at, by, reason}         it got called off, and why
//   blocked{on}                       something outside is in the way
//   requires / contains               the two relations between tasks
//
// What a task is filed under — `project`, `filed`, the `board` that is a saved
// filter over the filing — belongs to @yaks/project: a task with nothing filed
// is still a task, and a portfolio is a different idea from a to-do item.
//
// Four things are worth explaining about the shapes, because each is a decision
// somebody would otherwise make differently.
//
// Status is not stored. `task` declares it with the `status` keyword: a ladder
// over the `completed` and `cancelled` marks (`completed` is @yaks/kernel's,
// the mark anything finished wears), which gives it a computed `task.status`
// that is readable and filterable, and that no writer sets. Finishing a task
// means writing a fact with a time and an author rather than overwriting a
// value. Both evaluators read the one declaration, so `.status=done` selects
// the same tasks in a database and in a page, and a package that adds a rung
// (@yaks/session's `wip`) widens the closed set where it declares the rung.
//
// The two relations are `requires` and `contains`, as @yaks/edge reads them: a
// component that an edge entity carries beside `edge{from, to}`. Neither has
// any properties — the link itself is the whole of what they mean.
//
// Blocked is A component, not A status. `blocked{on}` records that something
// outside the graph is in the way — waiting on a vendor, on a decision, on a
// person. It is deliberately not a rung on the status ladder: a blocked task is
// still open work, and rolling it into the status would hide it from every
// open-work query exactly when somebody needs to see it. Unfinished `requires`
// children are not blocking either; they are ordinary work, counted and shown,
// never an alarm.
//
// The marks outlive the people. `cancelled.by` is `death: keep`, as the
// kernel's `completed.by` is — deleting the person who finished a task does not
// unfinish it. The reference stands as history.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import, and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component that makes an entity a task. */
export let TASK = 'task'

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
 * about what a person or a document is — bring your own `doc` (or
 * {@link https://jsr.io/@yaks/doc | @yaks/doc}'s), and whatever else your tasks
 * carry.
 *
 * `requires` and `contains` are declared through
 * {@link https://jsr.io/@yaks/edge | @yaks/edge}'s `edge` keyword, so an
 * edge entity carrying one of them states that link. Register `edgeKeywords`
 * when you load, or the loader will carry the declaration with nobody reading
 * it.
 */
export let taskDoc: VocabDoc = doc
