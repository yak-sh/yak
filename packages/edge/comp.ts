// The one component this package ships: `edge{from, to, ord}`.
//
// Both endpoints are references declared `death: cascade`, which is the whole
// of a link's lifecycle. A link exists only while both of its endpoints do — a
// post linking to a deleted post links to nothing — so the link entity is
// deleted with either endpoint and no reader ever finds a link with one end
// missing. That leaves nothing else to implement: no unlink bookkeeping, no
// orphan sweep, no nullable endpoint.
//
// `ord` is the link's position in a list, for the relations where order is part
// of the meaning (a reading list, a table of contents). It is optional; a
// relation with no order simply never writes it.
//
// The endpoints do not claim their property names as query shorthand
// (`bare: false`): `from` and `to` are too ordinary for this component to own
// vocabulary-wide, so a query writes them in full — `.edge.from=<id>`.
//
// The component itself is declared in `./vocab.json` — plain JSON Schema,
// readable by anything that reads JSON. This file re-exports it under the name
// callers import and keeps the explanation of why it is shaped this way.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/**
 * The `edge` component as a vocabulary document, to load beside your own:
 * `loadVocab([edgeDoc, ...mine], [edgeKeywords])`. The relation components are
 * yours to declare — this document is only the link itself.
 */
export let edgeDoc: VocabDoc = doc
