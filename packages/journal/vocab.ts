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

import { CORE_URI, type VocabDoc } from '@yaks/vocab'

/** The component name a committed batch wears. */
export let BATCH = 'batch'

/** The component name one recorded movement wears. */
export let DELTA = 'delta'

/**
 * The journal vocabulary, to load beside your own:
 * `loadVocab([journalDoc, ...mine])`. Two components — a `batch` per committed
 * write and a `delta` per column (or component) that moved — and nothing else.
 */
export let journalDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'journal',
  $defs: {
    batch: {
      type: 'object',
      properties: {
        seq: {
          type: 'number',
          stamped: true,
          description: "the batch's place in the total order — the cursor",
        },
        at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when it committed',
        },
        by: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: "the actor that wrote it, from the batch's $actor",
        },
        via: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: 'the instrument it was written through',
        },
      },
    },
    delta: {
      type: 'object',
      properties: {
        seq: {
          type: 'number',
          stamped: true,
          description: 'the batch this delta belongs to, by its seq',
        },
        ord: {
          type: 'number',
          stamped: true,
          description: 'its place within that batch — the order it happened',
        },
        target: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: 'the entity that changed — kept past its own death',
        },
        comp: {
          type: 'string',
          stamped: true,
          description: 'the component that changed',
        },
        column: {
          type: 'string',
          stamped: true,
          description:
            'the column that moved, or absent when the whole component did',
        },
        before: {
          type: 'string',
          stamped: true,
          description: 'the value it held, JSON — absent when it held none',
        },
        after: {
          type: 'string',
          stamped: true,
          description: 'the value it holds now, JSON — absent when cleared',
        },
      },
    },
  },
}
