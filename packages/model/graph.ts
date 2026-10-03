// The graph plugins this package contributes: the module a server imports at
// `@yaks/model/graph`. It adds the vocabulary, and a provider's or a model's
// name accepted wherever its eid is.

import type { Plugin } from '@yaks/graph'
import { models } from './mod.ts'

/** The `provider`, `model` and `tool` entities a graph stores about serving. */
export let plugins = (): Plugin[] => [models()]
