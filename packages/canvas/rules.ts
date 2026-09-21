// The graph plugins this package contributes: the module a server imports at
// `@yaks/canvas/rules`. The only write-time rule is declared in the
// vocabulary, as `death: cascade` on `card.target`.

import type { Plugin } from '@yaks/graph'
import { canvas } from './plugin.ts'

/** Cards, pins, cameras and the per-client state a canvas keeps. */
export let rules = (): Plugin[] => [canvas()]
