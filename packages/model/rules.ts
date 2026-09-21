// The graph plugins this package contributes: the module a server imports at
// `@yaks/model/rules`. It adds the vocabulary and no write-time behaviour.

import type { Plugin } from '@yaks/graph'
import { models } from './mod.ts'

/** The `provider`, `model` and `tool` entities a graph stores about serving. */
export let rules = (): Plugin[] => [models()]
