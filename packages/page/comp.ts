// The one component this package ships: `web{url, frozen_at, bytes}`.
//
// A page is not a record of a document; it is a WITNESSING. `url` is the
// address someone stood at, `frozen_at` the moment a copy of the bytes was
// taken, and `bytes` where that copy is. Two of the three are `stamped` —
// server-owned, readable but never wire-writable — because "this page was
// archived" is the host's account of what it did, and a client that could
// write it could claim an archive nobody holds.
//
// `url` declares `identity`, which is the whole of this package's find-or-
// mint: the entity's id is derived from the canonical address (@yaks/graph
// `identityEid`), so two witnesses of one page land on one entity by
// construction — no lookup to race, no uniqueness index to remember, and
// anybody holding a URL can name its page without asking. See ./url.ts.
//
// `bytes` yields its bare spelling (`bare: false`): far too ordinary a word
// for one component to claim vocabulary-wide, so it is said in full —
// `.web.bytes=<sha>`.
//
// THE TITLE IS NOT HERE. A page's title and prose are `doc{title, body}`,
// from @yaks/doc, which this package composes beside rather than ships: a
// vocabulary refuses a component declared twice, so the word keeps one home
// and a page is read by whatever already renders a `doc`.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// say and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming a page as witnessed. */
export let WEB = 'web'

/**
 * The `web` component as a vocabulary document, to load beside your own:
 * `loadVocab([docDoc, pageDoc, ...mine])`.
 */
export let pageDoc: VocabDoc = doc as VocabDoc
