// The graph plugins this package contributes: the module a server imports at
// `@yaks/draft/graph`, so a draft written from two interfaces at once keeps
// what both typed.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { drafts } from './plugin.ts'

/** The draft components and the merge that keeps concurrent typing. */
export let plugins = ({ vocab }: { vocab: Vocab }): Plugin[] =>
  // An app may have held either word before this package was composed there.
  // Its declaration stays its own, and its writes cannot acquire our merge.
  ['draft', 'typed'].every((name) => vocab.comp(name)?.package == '@yaks/draft')
    ? [drafts()]
    : []
