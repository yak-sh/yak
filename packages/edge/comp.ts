// The one component this package ships: `edge{from, to, ord}`.
//
// Both ends are references with `death: cascade`, which is the whole of an
// edge's lifecycle. A link exists only while both of its ends do — a post that
// links to a deleted post does not link to anything — so the edge entity dies
// with either end and no reader ever meets a half-sentence. Nothing else needs
// saying: there is no unlink bookkeeping, no orphan sweep, no nullable end.
//
// `ord` is the link's place in a list, for the relations where order is part of
// the meaning (a reading list, a table of contents). It is optional; a relation
// that has no order simply never writes it.
//
// The ends yield their bare words (`bare: false`): `from` and `to` are far too
// ordinary to be claimed vocabulary-wide by this component, so they are said in
// full — `.edge.from=<id>`.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// say and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/**
 * The `edge` component as a vocabulary document, to load beside your own:
 * `loadVocab([edgeDoc, ...mine], [edgeKeywords])`. The relation tags are yours
 * to declare — this document is only the link itself.
 */
export let edgeDoc: VocabDoc = doc
