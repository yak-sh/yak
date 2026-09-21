// The one component this package defines: `web{url, frozen_at, bytes}`.
//
// A page entity is not a record of a document as it is now; it records that
// somebody read a particular address at a particular moment. `url` is the
// address they were at, `frozen_at` the moment a copy of the bytes was taken,
// and `bytes` where that copy is. Two of the three are `stamped` —
// server-owned, readable by clients but never writable by them — because "this
// page was archived" is the server's account of what it did, and a client that
// could write it could claim an archive that does not exist.
//
// `url` is declared `identity`, which is this package's whole find-or-create
// mechanism: the entity's id is derived from the canonical address (@yaks/graph
// `identityEid`), so two recordings of one page land on one entity by
// construction — no lookup to race, no uniqueness index to remember, and anyone
// holding a URL can compute its entity id without asking. See ./url.ts.
//
// `bytes` opts out of the short form (`bare: false`): far too ordinary a name
// for one component to claim vocabulary-wide, so a query names it in full —
// `.web.bytes=<sha>`.
//
// THE TITLE IS NOT HERE. A page's title and prose are `doc{title, body}` from
// @yaks/doc, which this package loads beside its own rather than redefining: a
// vocabulary refuses a component declared twice, so the component keeps one
// home and a page is rendered by whatever already renders a `doc`.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import, and keeps the prose about why it is shaped this way.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The name of the component recording a page as it was seen. */
export let WEB = 'web'

/**
 * The `web` component as a vocabulary document, to load beside your own:
 * `loadVocab([docDoc, pageDoc, ...mine])`.
 */
export let pageDoc: VocabDoc = doc as VocabDoc
