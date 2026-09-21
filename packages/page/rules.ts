// The @yaks/graph plugin, exported as `@yaks/page/rules`. An address is
// canonicalized on the way in, and the entity id follows from that — which is a
// rule about what a write means, not just a component definition, so it is
// exported separately from `./vocab`.

import type { Plugin } from '@yaks/graph'
import { pages } from './plugin.ts'

/** The `web` component, plus canonicalization of its address. */
export let rules = (): Plugin[] => [pages()]
