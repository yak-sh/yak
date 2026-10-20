// Where a stored value lives: the module a server imports from
// `@yaks/blob/graph`. The store is the host's own (`host.blobs`); the schema declarations are in ./vocab.ts,
// where a browser can load them without a store coming with them.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { blobs } from './plugin.ts'
import { representations } from './representation_rules.ts'
import type { Blobs } from './store.ts'

/** The plugin for every body property this vocabulary marks `store: blob`,
 * storing each distinct value once in the host's blob store however many rows
 * hold the same text. */
export let plugins = (host: { vocab: Vocab; blobs: Blobs }): Plugin[] => [
  blobs(host.vocab, host.blobs),
  representations(),
]

/** A store this plugin wrote keeps an address where each body's text was,
 * which only this plugin reads back as text and writes in its place: from
 * then on the store requires it (@yaks/host `GraphFacet.required`). */
export let required = (): boolean => true
