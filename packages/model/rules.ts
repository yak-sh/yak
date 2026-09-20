// What a batch MEANS about serving: the `rules` facet a host takes
// (`@yaks/model/rules`).

import type { Plugin } from '@yaks/graph'
import { models } from './mod.ts'

/** The `provider`, `model` and `tool` entities a graph keeps about serving. */
export let rules = (): Plugin[] => [models()]
