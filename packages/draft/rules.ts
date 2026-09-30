// The graph plugins this package contributes: the module a server imports at
// `@yaks/draft/rules`, so a draft written from two interfaces at once keeps
// what both typed.

import type { Plugin } from '@yaks/graph'
import { drafts } from './plugin.ts'

/** The draft components and the merge that keeps concurrent typing. */
export let rules = (): Plugin[] => [drafts()]
