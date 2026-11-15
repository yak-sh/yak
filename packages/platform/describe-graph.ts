// An app store holds its own rows, not a copy of the platform's words: every
// schema page in it is derived from the vocabulary when read (@yaks/code
// `describing`). The platform's own two stores describe theirs in rows.
import type { Plugin } from '@yaks/graph'
import { describing } from '@yaks/code/described'

export let plugins = (): Plugin[] => [describing]
