// The `graph` export (`@yaks/egress/graph`): each call out through a `uses`
// link counted on it, inside the write that says it went out (./calls.ts). A
// host composes it like any plugin's graph facet, wherever `uses` links are
// kept; nothing calls it by hand.

import type { Plugin } from '@yaks/graph'
import { counting } from './calls.ts'

/** The fold of `called` events into each link's `calls`. */
export let plugins = (): Plugin[] => [counting()]
