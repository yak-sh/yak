// The journal's own two components. A log is data like anything else here, so
// the record of a write is entities wearing components — queryable with the
// same grammar, stored by the same adapter, readable by anything that speaks
// bundles.
//
//   batch{seq, at, by, via}                          one per committed batch
//   delta{seq, ord, target, comp, column, before, after}  one per thing moved
//
// A delta names its batch by `seq` rather than by a reference: `seq` is the
// total order, the cursor, and the join key at once, so a feed pages a range
// of batches and their deltas with two comparisons and no walk. `ord` is the
// order WITHIN a batch, written down rather than left to whatever order an
// adapter happens to return rows in.
//
// Every column is server-owned (`stamped`): a client never writes history.
// `target` keeps its reference past the target's death — the point of a
// journal is that it outlives what it is about — so it carries no foreign key
// and a tombstoned entity keeps every delta ever written about it.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// say and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component name a committed batch wears. */
export let BATCH = 'batch'

/** The component name one recorded movement wears. */
export let DELTA = 'delta'

/**
 * The journal vocabulary, to load beside your own:
 * `loadVocab([journalDoc, ...mine])`. Two components — a `batch` per committed
 * write and a `delta` per column (or component) that moved — and nothing else.
 */
export let journalDoc: VocabDoc = doc
